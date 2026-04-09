require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

// --- CLOUDINARY PACKAGES IMPORT ---
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;

// --- DATABASE CONNECTION ---
const dbURI = process.env.MONGODB_URI;
mongoose.connect(dbURI)
    .then(() => {
        console.log(`Connected Successfully!`);
    })
    .catch((err) => {
        console.log(`Database connection error: `, err);
    });

// --- MODELS IMPORT ---
const Product = require('./models/product'); 
const MarketRate = require('./models/MarketRate');
const User = require('./models/user'); 
const Cart = require('./models/cart'); 
const Wishlist = require('./models/wishlist'); 
const Order = require('./models/order'); 
const CustomOrder = require('./models/customOrder');
const Subscriber = require('./models/subscriber');
const Enquiry = require('./models/enquiry'); 

// ==========================================
//             CLOUDINARY SETUP 
// ==========================================
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET 
});

// --- MULTER SETUP ---
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'smjewellers_products', 
        allowedFormats: ['jpeg', 'png', 'jpg', 'webp'] 
    }
});

const upload = multer({ storage: storage });

// --- MIDDLEWARES ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- SESSION SETUP ---
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

// ==========================================
//             SMART AUTO-CLEANER 
// ==========================================
app.use(async (req, res, next) => {
    res.locals.user = req.session.user || null;
    
    try {
        const latestRate = await MarketRate.findOne().sort({ _id: -1 });
        res.locals.liveRate = latestRate || { silverRate: 0, goldRate22K: 0 };
    } catch (err) {
        res.locals.liveRate = { silverRate: 0, goldRate22K: 0 };
    }

    let cartItemCount = 0;
    let wishlistItemCount = 0; 
    let userWishlist = []; 

    if (req.session.user) {
        try {
            // CART CLEANUP
            const cart = await Cart.findOne({ userId: req.session.user.id }).populate('items.productId');
            if (cart) {
                const validCartItems = cart.items.filter(item => item.productId != null);
                if (validCartItems.length !== cart.items.length) {
                    cart.items = validCartItems.map(item => ({ productId: item.productId._id, quantity: item.quantity }));
                    await cart.save(); 
                }
                cartItemCount = validCartItems.reduce((total, item) => total + item.quantity, 0); 
            }

            // WISHLIST CLEANUP
            const wishlist = await Wishlist.findOne({ userId: req.session.user.id }).populate('items.productId');
            if (wishlist) {
                const validWishlistItems = wishlist.items.filter(item => item.productId != null);
                if (validWishlistItems.length !== wishlist.items.length) {
                    wishlist.items = validWishlistItems.map(item => ({ productId: item.productId._id }));
                    await wishlist.save(); 
                }
                wishlistItemCount = validWishlistItems.length; 
                userWishlist = validWishlistItems.map(item => item.productId._id.toString()); 
            }
        } catch (err) {
            console.log("Cleanup error:", err);
        }
    }
    
    res.locals.cartItemCount = cartItemCount;
    res.locals.wishlistItemCount = wishlistItemCount; 
    res.locals.userWishlist = userWishlist; 
    next();
});

// ==========================================
//             AUTHENTICATION ROUTES
// ==========================================

app.get('/signup', (req, res) => { 
    const errorMsg = req.session.signupError;
    req.session.signupError = null; 
    res.render('signup', { error: errorMsg }); 
});

app.post('/signup', async (req, res) => {
    try {
        const { name, email, mobile, password, confirmPassword } = req.body;

        if (password !== confirmPassword) {
            req.session.signupError = "Passwords do not match! Please type carefully.";
            return res.redirect('/signup');
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            req.session.signupError = "This email is already registered! Please Login.";
            return res.redirect('/signup');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        let userRole = 'customer'; 
        if (email === 'support.smjewellers@gmail.com') { userRole = 'admin'; }

        const newUser = new User({ 
            name, 
            email, 
            mobile, 
            password: hashedPassword, 
            role: userRole 
        });
        await newUser.save();

        req.session.loginSuccess = "Account created successfully! Please login.";
        res.redirect('/login');
    } catch (err) { 
        req.session.signupError = "Server Error! Please try again.";
        res.redirect('/signup');
    }
});

app.get('/login', (req, res) => {
    const errorMsg = req.session.loginError;
    const successMsg = req.session.loginSuccess;
    req.session.loginError = null;
    req.session.loginSuccess = null;
    res.render('login', { error: errorMsg, success: successMsg });
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            req.session.loginError = "Invalid Email! This email is not registered.";
            return res.redirect('/login');
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            req.session.loginError = "Incorrect Password! Please try again.";
            return res.redirect('/login');
        }

        if (user.email === 'support.smjewellers@gmail.com' && user.role !== 'admin') { 
            user.role = 'admin';
            await user.save(); 
        }

        req.session.user = { id: user._id, name: user.name, role: user.role };
        res.redirect('/');
    } catch (err) { 
        req.session.loginError = "Server Error! Please try again later.";
        res.redirect('/login');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ==========================================
//             FORGOT PASSWORD LOGIC
// ==========================================

app.get('/forgot-password', (req, res) => {
    const errorMsg = req.session.forgotError;
    req.session.forgotError = null;
    res.render('forgot-password', { error: errorMsg });
});

app.post('/forgot-password', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email });
        
        if (!user) {
            req.session.forgotError = "This email is not registered! Please check the spelling.";
            return res.redirect('/forgot-password');
        }

        const otp = Math.floor(1000 + Math.random() * 9000); 
        req.session.resetOtp = otp;
        req.session.resetEmail = req.body.email;

        const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
    }
});

        const mailOptions = {
    from: process.env.EMAIL_USER, 
    to: req.body.email,
            subject: 'Shree Mahalakshmi Jewellers - Password Reset OTP',
            html: `<div style="font-family: Arial, sans-serif; text-align: center; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                    <h2 style="color: #d4af37;">Shree Mahalakshmi Jewellers</h2>
                    <p>You requested to reset your password. Here is your One Time Password (OTP):</p>
                    <h1 style="color: #2c3e50; letter-spacing: 5px; font-size: 36px;">${otp}</h1>
                    <p style="color: #7f8c8d; font-size: 12px;">If you didn't request this, please ignore this email.</p>
                   </div>`
        };

        await transporter.sendMail(mailOptions);
        res.render('verify-otp', { email: req.body.email, error: null });
    } catch (err) { 
        console.log("Email bhejne me error:", err);
        req.session.forgotError = "Failed to send email. Please check internet connection or email configuration.";
        res.redirect('/forgot-password');
    }
});

app.post('/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword, confirmPassword } = req.body;
        if (!req.session.resetOtp || !req.session.resetEmail) {
            return res.render('verify-otp', { email: email, error: "Session Expired! Please go back and request a new OTP." });
        }
        const serverOtp = String(req.session.resetOtp).trim();
        const clientOtp = String(otp).trim();
        const serverEmail = String(req.session.resetEmail).trim().toLowerCase();
        const clientEmail = String(email).trim().toLowerCase();
        if (serverOtp !== clientOtp || serverEmail !== clientEmail) {
            console.log(`Mismatch! Server OTP: ${serverOtp}, Client OTP: ${clientOtp}`); 
            return res.render('verify-otp', { email: email, error: "Invalid OTP! Please check the 4 digits again." });
        }
        if (newPassword !== confirmPassword) {
            return res.render('verify-otp', { email: email, error: "Passwords do not match! Please type carefully." });
        }
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.findOneAndUpdate({ email: serverEmail }, { password: hashedPassword });
        req.session.resetOtp = null;
        req.session.resetEmail = null;
        req.session.loginSuccess = "Password Reset Successful! Please Login with your new password.";
        res.redirect('/login');

    } catch (err) { 
        console.log("Password Reset Error:", err);
        res.render('verify-otp', { email: req.body.email, error: "Password reset failed. Please try again." });
    }
});

// ==========================================
//             MAIN WEBSITE ROUTES
// ==========================================

app.get('/', async (req, res) => {
    try {
        let trendingItems = await Product.find({ isTrending: true });
        let rateForGold = res.locals.liveRate ? res.locals.liveRate.goldRate22K : 0;
        let rateForSilver = res.locals.liveRate ? (res.locals.liveRate.silverRate / 1000) : 0;

        let trendingWithPrice = trendingItems.map(item => {
            let itemData = item.toObject();
            if (itemData.category === 'Gold') itemData.calculatedPrice = (rateForGold * itemData.weightInGrams) + itemData.makingCharges;
            else if (itemData.category === 'Silver') itemData.calculatedPrice = (rateForSilver * itemData.weightInGrams) + itemData.makingCharges;
            else itemData.calculatedPrice = itemData.makingCharges; 
            return itemData;
        });

        res.render('index', { trendingProducts: trendingWithPrice }); 
    } catch (err) { res.render('index', { trendingProducts: [] }); }
});

app.get('/gold', async (req, res) => {
    try {
        let goldProducts = await Product.find({ category: 'Gold' });
        let ratePerGram = res.locals.liveRate ? res.locals.liveRate.goldRate22K : 0;

        let productsWithPrice = goldProducts.map(item => {
            let itemData = item.toObject();
            itemData.calculatedPrice = (ratePerGram * itemData.weightInGrams) + itemData.makingCharges;
            return itemData;
        });

        if (req.query.cat) {
            let selectedCats = Array.isArray(req.query.cat) ? req.query.cat : [req.query.cat];
            productsWithPrice = productsWithPrice.filter(p => selectedCats.some(cat => p.name.toLowerCase().includes(cat.toLowerCase().replace(/s$/, ''))));
        }

        const priceFilter = req.query.price;
        if (priceFilter === 'under20000') productsWithPrice = productsWithPrice.filter(p => p.calculatedPrice < 20000);
        else if (priceFilter === '20000to50000') productsWithPrice = productsWithPrice.filter(p => p.calculatedPrice >= 20000 && p.calculatedPrice <= 50000);
        else if (priceFilter === 'above50000') productsWithPrice = productsWithPrice.filter(p => p.calculatedPrice > 50000);

        const sortFilter = req.query.sort;
        if (sortFilter === 'lowToHigh') productsWithPrice.sort((a, b) => a.calculatedPrice - b.calculatedPrice);
        else if (sortFilter === 'highToLow') productsWithPrice.sort((a, b) => b.calculatedPrice - a.calculatedPrice);

        // --- PAGINATION LOGIC START ---
        const page = parseInt(req.query.page) || 1; // कस्टमर अभी किस पेज पर है? (Default: 1)
        const limit = 12; // 1 पेज पर 12 फोटो
        const totalItems = productsWithPrice.length; // फिल्टर होने के बाद टोटल कितनी फोटो बचीं?
        const totalPages = Math.ceil(totalItems / limit) || 1; // टोटल कितने पेज बनेंगे?

        const skip = (page - 1) * limit;
        const paginatedProducts = productsWithPrice.slice(skip, skip + limit); // सिर्फ 12 फोटो काटो
        // --- PAGINATION LOGIC END ---

        res.render('gold', { 
            products: paginatedProducts, 
            currentPage: page, 
            totalPages: totalPages 
        });
    } catch (err) { res.status(500).send("Error"); }
});

app.get('/silver', async (req, res) => {
    try {
        let silverProducts = await Product.find({ category: 'Silver' });
        let ratePerGram = res.locals.liveRate ? (res.locals.liveRate.silverRate / 1000) : 0;

        let productsWithPrice = silverProducts.map(item => {
            let itemData = item.toObject(); 
            itemData.calculatedPrice = (ratePerGram * itemData.weightInGrams) + itemData.makingCharges;
            return itemData;
        });

        if (req.query.cat) {
            let selectedCats = Array.isArray(req.query.cat) ? req.query.cat : [req.query.cat];
            productsWithPrice = productsWithPrice.filter(p => selectedCats.some(cat => p.name.toLowerCase().includes(cat.toLowerCase().replace(/s$/, ''))));
        }

        const priceFilter = req.query.price;
        if (priceFilter === 'under2000') productsWithPrice = productsWithPrice.filter(p => p.calculatedPrice < 2000);
        else if (priceFilter === '2000to5000') productsWithPrice = productsWithPrice.filter(p => p.calculatedPrice >= 2000 && p.calculatedPrice <= 5000);
        else if (priceFilter === 'above5000') productsWithPrice = productsWithPrice.filter(p => p.calculatedPrice > 5000);

        const sortFilter = req.query.sort;
        if (sortFilter === 'lowToHigh') productsWithPrice.sort((a, b) => a.calculatedPrice - b.calculatedPrice);
        else if (sortFilter === 'highToLow') productsWithPrice.sort((a, b) => b.calculatedPrice - a.calculatedPrice);

        // --- PAGINATION LOGIC START ---
        const page = parseInt(req.query.page) || 1; 
        const limit = 12; 
        const totalItems = productsWithPrice.length; 
        const totalPages = Math.ceil(totalItems / limit) || 1; 

        const skip = (page - 1) * limit;
        const paginatedProducts = productsWithPrice.slice(skip, skip + limit); 
        // --- PAGINATION LOGIC END ---

        res.render('silver', { 
            products: paginatedProducts,
            currentPage: page, 
            totalPages: totalPages 
        });
    } catch (err) { res.status(500).send("Error"); }
});

app.get('/artificial', async (req, res) => {
    try {
        let artificialProducts = await Product.find({ category: 'Artificial' });

        let productsWithPrice = artificialProducts.map(item => {
            let itemData = item.toObject();
            itemData.calculatedPrice = itemData.makingCharges; 
            return itemData;
        });

        if (req.query.cat) {
            let selectedCats = Array.isArray(req.query.cat) ? req.query.cat : [req.query.cat];
            productsWithPrice = productsWithPrice.filter(p => selectedCats.some(cat => p.name.toLowerCase().includes(cat.toLowerCase().replace(/s$/, ''))));
        }

        const priceFilter = req.query.price;
        if (priceFilter === 'under1000') productsWithPrice = productsWithPrice.filter(p => p.calculatedPrice < 1000);
        else if (priceFilter === '1000to5000') productsWithPrice = productsWithPrice.filter(p => p.calculatedPrice >= 1000 && p.calculatedPrice <= 5000);
        else if (priceFilter === 'above5000') productsWithPrice = productsWithPrice.filter(p => p.calculatedPrice > 5000);

        const sortFilter = req.query.sort;
        if (sortFilter === 'lowToHigh') productsWithPrice.sort((a, b) => a.calculatedPrice - b.calculatedPrice);
        else if (sortFilter === 'highToLow') productsWithPrice.sort((a, b) => b.calculatedPrice - a.calculatedPrice);

        // --- PAGINATION LOGIC START ---
        const page = parseInt(req.query.page) || 1; 
        const limit = 12; 
        const totalItems = productsWithPrice.length; 
        const totalPages = Math.ceil(totalItems / limit) || 1; 

        const skip = (page - 1) * limit;
        const paginatedProducts = productsWithPrice.slice(skip, skip + limit); 
        // --- PAGINATION LOGIC END ---

        res.render('artificial', { 
            products: paginatedProducts,
            currentPage: page, 
            totalPages: totalPages 
        });
    } catch (err) { res.status(500).send("Error"); }
});

app.get('/product/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id).populate('reviews.userId');
        if (!product) return res.redirect('/');

        let itemData = product.toObject();
        if (itemData.category === 'Gold') {
            let rate = res.locals.liveRate ? res.locals.liveRate.goldRate22K : 0;
            itemData.calculatedPrice = (rate * itemData.weightInGrams) + itemData.makingCharges;
        } else if (itemData.category === 'Silver') {
            let rate = res.locals.liveRate ? (res.locals.liveRate.silverRate / 1000) : 0;
            itemData.calculatedPrice = (rate * itemData.weightInGrams) + itemData.makingCharges;
        } else {
            itemData.calculatedPrice = itemData.makingCharges;
        }
        res.render('product', { product: itemData });
    } catch (err) { res.redirect('/'); }
});

// ==========================================
//             SMART SEARCH ROUTE
// ==========================================

app.get('/search', async (req, res) => {
    try {
        let originalQuery = req.query.q || '';
        let searchQuery = originalQuery.trim().toLowerCase();

        const typoMap = {
            "neckless": "necklace",
            "neclace": "necklace",
            "ering": "earring",
            "earings": "earrings",
            "bangel": "bangle",
            "braclet": "bracelet",
            "manglsutra": "mangalsutra"
        };

        if (typoMap[searchQuery]) {
            searchQuery = typoMap[searchQuery];
        }

        let searchRegex = new RegExp(searchQuery, 'i');

        if (searchQuery === 'ring' || searchQuery === 'rings') {
            searchRegex = new RegExp(`\\b${searchQuery}\\b`, 'i');
        }

        const searchResults = await Product.find({
            $or: [
                { name: { $regex: searchRegex } }, 
                { category: { $regex: searchRegex } } 
            ]
        });

        let rateForGold = res.locals.liveRate ? res.locals.liveRate.goldRate22K : 0;
        let rateForSilver = res.locals.liveRate ? (res.locals.liveRate.silverRate / 1000) : 0;

        let productsWithPrice = searchResults.map(item => {
            let itemData = item.toObject();
            if (itemData.category === 'Gold') itemData.calculatedPrice = (rateForGold * itemData.weightInGrams) + itemData.makingCharges;
            else if (itemData.category === 'Silver') itemData.calculatedPrice = (rateForSilver * itemData.weightInGrams) + itemData.makingCharges;
            else itemData.calculatedPrice = itemData.makingCharges; 
            return itemData;
        });

        res.render('search', { products: productsWithPrice, searchQuery: originalQuery });
    } catch (err) { 
        res.send("Search error."); 
    }
});

// ==========================================
//             ADMIN ROUTES
// ==========================================

app.get('/admin', (req, res) => { 
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
    res.render('admin', { rate: res.locals.liveRate }); 
});
app.get('/admin/analytics', async (req, res) => { 
    try {
        if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');

        const totalOrders = await Order.countDocuments();
        const totalProducts = await Product.countDocuments();
        const totalUsers = await User.countDocuments({ role: 'customer' });

        const orders = await Order.find();
        let totalRevenue = 0;
        let productSales = {};

        orders.forEach(order => {
            totalRevenue += order.totalAmount; 
            order.items.forEach(item => {
                if(productSales[item.productName]) {
                    productSales[item.productName] += item.quantity;
                } else {
                    productSales[item.productName] = item.quantity;
                }
            });
        });

        let sortedProducts = Object.entries(productSales).sort((a, b) => b[1] - a[1]).slice(0, 5);
        let topProductNames = sortedProducts.map(p => p[0]); 
        let topProductQuantities = sortedProducts.map(p => p[1]); 

        const outOfStockItems = await Product.find({ inStock: false }).limit(5);

        res.render('admin-analytics', { 
            totalOrders, totalProducts, totalUsers, totalRevenue,
            topProductNames: JSON.stringify(topProductNames),
            topProductQuantities: JSON.stringify(topProductQuantities),
            outOfStockItems 
        }); 
    } catch (err) { 
        console.log("Analytics Error:", err);
        res.redirect('/admin'); 
    }
});

app.get('/admin/manage-products', async (req, res) => {
    try {
        const allProducts = await Product.find().sort({ _id: -1 });
        res.render('manage-products', { products: allProducts, isTrendingPage: false });
    } catch (err) { res.render('manage-products', { products: [], isTrendingPage: false }); }
});

app.get('/admin/trending', async (req, res) => {
    try {
        const trendingProducts = await Product.find({ isTrending: true }).sort({ _id: -1 });
        res.render('manage-products', { products: trendingProducts, isTrendingPage: true });
    } catch (err) { res.redirect('/admin'); }
});

app.post('/admin/remove-trending/:id', async (req, res) => {
    try {
        await Product.findByIdAndUpdate(req.params.id, { isTrending: false });
        res.redirect('/admin/trending');
    } catch (err) { res.send("Error removing from trending."); }
});

app.get('/admin/edit-product/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.redirect('/admin/manage-products');
        res.render('edit-product', { product });
    } catch (err) { res.redirect('/admin/manage-products'); }
});

app.post('/admin/edit-product/:id', upload.single('image'), async (req, res) => {
    try {
        const { name, category, weightInGrams, makingCharges, description } = req.body;
        const trendingStatus = req.body.isTrending === 'true';
        
        let updateData = { 
            name, 
            category, 
            weightInGrams: weightInGrams || 0, 
            makingCharges: makingCharges || 0, 
            description: description || 'Premium Quality Jewellery', 
            isTrending: trendingStatus 
        };

        if (req.file) {
            updateData.imagePath = req.file.path;
        }

        await Product.findByIdAndUpdate(req.params.id, updateData);
        res.redirect('/admin/manage-products');
    } catch (err) { 
        console.log("Edit product error:", err);
        res.send("Product update error: " + err.message); 
    }
});

app.post('/admin/add-product', upload.single('image'), async (req, res) => {
    try {
        const { name, category, weightInGrams, makingCharges, description } = req.body;
        
        let mainImagePath = req.file ? req.file.path : '';

        const newProduct = new Product({ 
            name, 
            category, 
            weightInGrams: weightInGrams || 0, 
            makingCharges: makingCharges || 0, 
            description: description || 'Premium Jewellery', 
            imagePath: mainImagePath, 
            isTrending: req.body.isTrending === 'true',
            inStock: true 
        });
        
        await newProduct.save();
        res.redirect('/admin/manage-products'); 
    } catch (err) { 
        console.log("Add product error:", err);
        res.send("Error: " + err.message); 
    }
});

app.get('/admin/products/toggle-stock/:id', async (req, res) => {
    try {
        if (!req.session.user || req.session.user.role !== 'admin') {
            return res.redirect('/login');
        }
        
        const product = await Product.findById(req.params.id);
        if (product) {
            product.inStock = !product.inStock; 
            await product.save();
        }
        
        res.redirect('/admin/manage-products'); 
    } catch (err) {
        console.log("Stock Toggle Error:", err);
        res.redirect('/admin/manage-products');
    }
});

app.post('/admin/update-rates', async (req, res) => {
    try {
        const { goldRate22K, silverRate } = req.body;
        await MarketRate.deleteMany({}); 
        const newRate = new MarketRate({ goldRate22K, silverRate });
        await newRate.save();
        res.redirect('/admin');
    } catch (err) { res.send("Rate update error."); }
});

app.post('/admin/delete-product/:id', async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.redirect('/admin/manage-products'); 
    } catch (err) { res.send("Delete error."); }
});

// ==========================================
//             REVIEW ROUTE
// ==========================================
app.post('/product/:id/review', async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login');
        
        const { comment, rating } = req.body; 
        const productId = req.params.id;
        
        await Product.findByIdAndUpdate(productId, {
            $push: {
                reviews: {
                    userId: req.session.user.id,
                    userName: req.session.user.name,
                    rating: parseInt(rating) || 5, 
                    comment: comment,
                    date: new Date()
                }
            }
        });
        
        res.redirect('/product/' + productId);
    } catch (err) {
        console.log("Review error:", err);
        res.redirect('/');
    }
});

app.post('/product/:productId/review/:reviewId/delete', async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login');
        
        const { productId, reviewId } = req.params;
        const product = await Product.findById(productId);
        
        if (!product) return res.redirect('back');

        const review = product.reviews.id(reviewId);
        if (review) {
            if (review.userId.toString() === req.session.user.id || req.session.user.role === 'admin') {
                await Product.findByIdAndUpdate(productId, {
                    $pull: { reviews: { _id: reviewId } } 
                });
            }
        }
        res.redirect('/product/' + productId);
    } catch (err) {
        console.log("Review delete error:", err);
        res.redirect('back');
    }
});

// ==========================================
//   ADMIN REVIEW MANAGEMENT LOGIC
// ==========================================

app.get('/admin/reviews', async (req, res) => {
    try {
        if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
        
        const productsWithReviews = await Product.find({ 'reviews.0': { $exists: true } }).sort({ _id: -1 });
        res.render('admin-reviews', { products: productsWithReviews });
    } catch (err) { 
        res.send("Error loading admin reviews"); 
    }
});

app.post('/admin/delete-review/:productId/:reviewId', async (req, res) => {
    try {
        if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
        
        await Product.findByIdAndUpdate(req.params.productId, {
            $pull: { reviews: { _id: req.params.reviewId } }
        });
        
        res.redirect('/admin/reviews');
    } catch (err) { 
        res.send("Error deleting review"); 
    }
});

// ==========================================
//             CART ROUTES 
// ==========================================

app.get('/cart', async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login'); 
        const cart = await Cart.findOne({ userId: req.session.user.id }).populate('items.productId');
        res.render('cart', { cart: cart, rate: res.locals.liveRate });
    } catch (err) { res.send("Cart load error."); }
});

app.post('/cart/add/:productId', async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login'); 
        const userId = req.session.user.id;
        const productId = req.params.productId;
        let cart = await Cart.findOne({ userId });

        if (!cart) {
            cart = new Cart({ userId, items: [{ productId, quantity: 1 }] });
        } else {
            const itemIndex = cart.items.findIndex(p => p.productId && p.productId.toString() === productId);
            if (itemIndex > -1) {
                cart.items[itemIndex].quantity += 1; 
            } else {
                cart.items.push({ productId, quantity: 1 });
            }
        }
        await cart.save();
        res.redirect('/cart'); 
    } catch (err) { res.send("Cart add error."); }
});

app.post('/cart/decrease/:productId', async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login');
        const userId = req.session.user.id;
        const productId = req.params.productId;

        let cart = await Cart.findOne({ userId });
        if (cart) {
            const itemIndex = cart.items.findIndex(p => p.productId && p.productId.toString() === productId);
            if (itemIndex > -1) {
                if (cart.items[itemIndex].quantity > 1) {
                    cart.items[itemIndex].quantity -= 1; 
                } else {
                    cart.items.splice(itemIndex, 1); 
                }
                await cart.save();
            }
        }
        res.redirect('/cart');
    } catch (err) { res.send("Decrease error."); }
});

app.post('/cart/remove/:productId', async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login');
        const userId = req.session.user.id;
        const productId = req.params.productId;

        let cart = await Cart.findOne({ userId });
        if (cart) {
            cart.items = cart.items.filter(item => item.productId != null && item.productId.toString() !== productId);
            await cart.save();
        }
        res.redirect('/cart');
    } catch (err) { res.send("Item remove error."); }
});

// ==========================================
//             WISHLIST ROUTES
// ==========================================

app.get('/wishlist', async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login');
        const wishlist = await Wishlist.findOne({ userId: req.session.user.id }).populate('items.productId');
        res.render('wishlist', { wishlist });
    } catch (err) { res.send("Wishlist load error."); }
});

// ==========================================
//             WISHLIST TOGGLE 
// ==========================================
app.post('/api/wishlist/toggle/:productId', async (req, res) => {
    try {
        if (!req.session.user) return res.json({ success: false, message: 'login_required' });

        const userId = req.session.user.id;
        const productId = req.params.productId;
        let wishlist = await Wishlist.findOne({ userId });

        let action = '';
        if (!wishlist) {
            wishlist = new Wishlist({ userId, items: [{ productId }] });
            await wishlist.save();
            action = 'added';
        } else {
            const itemIndex = wishlist.items.findIndex(p => p.productId && p.productId.toString() === productId);
            if (itemIndex > -1) {
                wishlist.items.splice(itemIndex, 1);
                action = 'removed';
            } else {
                wishlist.items.push({ productId });
                action = 'added';
            }
            await wishlist.save();
        }

        return res.json({ success: true, action: action });
    } catch (err) { 
        res.json({ success: false, message: 'error' }); 
    }
});

app.post('/wishlist/remove/:productId', async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login');
        const userId = req.session.user.id;
        const productId = req.params.productId;

        let wishlist = await Wishlist.findOne({ userId });
        if (wishlist) {
            wishlist.items = wishlist.items.filter(item => item.productId != null && item.productId.toString() !== productId);
            await wishlist.save();
        }
        res.redirect('/wishlist');
    } catch (err) { res.send("Item remove error."); }
});

// ==========================================
//             USER DASHBOARD & ORDERS
// ==========================================

app.get('/profile', async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login');
        const currentUser = await User.findById(req.session.user.id);
        res.render('profile', { userData: currentUser });
    } catch (err) { 
        res.redirect('/login'); 
    }
});

app.post('/profile/edit', async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login');
        
        const { name, mobile } = req.body;
        
        await User.findByIdAndUpdate(req.session.user.id, { name, mobile });
        req.session.user.name = name; 
        
        res.redirect('/profile');
    } catch (err) {
        console.log("Profile update error:", err);
        res.redirect('/profile');
    }
});

app.get('/orders', async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login');
        const userOrders = await Order.find({ userId: req.session.user.id }).sort({ orderDate: -1 });
        res.render('orders', { orders: userOrders });
    } catch (err) { res.send("Error loading orders"); }
});

// ==========================================
//             CHECKOUT & ORDERS LOGIC
// ==========================================

app.get('/checkout', async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login');
        
        const cart = await Cart.findOne({ userId: req.session.user.id }).populate('items.productId');
        if (!cart || cart.items.length === 0) return res.redirect('/cart');

        const currentUser = await User.findById(req.session.user.id);
        res.render('checkout', { cart: cart, user: currentUser });
    } catch (err) { res.redirect('/cart'); }
});

app.post('/place-order', async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login');
        
        const cart = await Cart.findOne({ userId: req.session.user.id }).populate('items.productId');
        if (!cart || cart.items.length === 0) return res.redirect('/cart');

        const { fullName, phone, street, city, state, pincode, paymentMethod } = req.body;

        let totalAmount = 0;
        let orderItems = [];

        cart.items.forEach(item => {
            if(item.productId) {
                let price = item.productId.makingCharges; 
                if (item.productId.category === 'Gold' && res.locals.liveRate) price = (res.locals.liveRate.goldRate22K * item.productId.weightInGrams) + item.productId.makingCharges;
                else if (item.productId.category === 'Silver' && res.locals.liveRate) price = ((res.locals.liveRate.silverRate / 1000) * item.productId.weightInGrams) + item.productId.makingCharges;

                orderItems.push({
                    productId: item.productId._id, 
                    productName: item.productId.name,
                    productImage: item.productId.imagePath,
                    quantity: item.quantity,
                    price: price
                });
                totalAmount += (price * item.quantity);
            }
        });

        const finalAmount = totalAmount + (totalAmount * 0.03);

        const newOrder = new Order({
            userId: req.session.user.id,
            items: orderItems,
            totalAmount: finalAmount,
            shippingAddress: { fullName, phone, street, city, state, pincode },
            paymentMethod: paymentMethod,
            orderStatus: 'Processing'
        });
        
        await newOrder.save();
        await Cart.findOneAndDelete({ userId: req.session.user.id });
        res.render('order-success', { orderId: newOrder._id });
    } catch (err) { 
        console.log("Order placing error:", err);
        res.send("Order placing error."); 
    }
});

// ==========================================
//   ADMIN ORDER MANAGEMENT LOGIC
// ==========================================

app.get('/admin/orders', async (req, res) => {
    try {
        if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
        const allOrders = await Order.find().populate('userId').sort({ orderDate: -1 });
        res.render('admin-orders', { orders: allOrders });
    } catch (err) { res.send("Error loading admin orders"); }
});

app.post('/admin/orders/update-status/:id', async (req, res) => {
    try {
        if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
        await Order.findByIdAndUpdate(req.params.id, { orderStatus: req.body.status });
        res.redirect('/admin/orders');
    } catch (err) { res.send("Error updating status"); }
});

// ==========================================
//  CUSTOM ORDER ROUTES (USER & ADMIN) 
// ==========================================

app.get('/custom-order', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.render('custom-order', { user: req.session.user });
});

app.post('/custom-order', upload.array('designImage', 5), async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login');

        let uploadedImages = [];
        if (req.files && req.files.length > 0) {
            uploadedImages = req.files.map(file => file.path); 
        }

        const newOrder = new CustomOrder({
            userId: req.session.user.id,
            customerName: req.body.customerName,
            phone: req.body.phone,
            details: req.body.details,
            imagePaths: uploadedImages
        });
        
        await newOrder.save();
        res.send("<script>alert('Your Custom Design Request has been sent successfully!'); window.location.href='/';</script>");
    } catch (err) {
        console.log("Custom Order Error:", err);
        res.redirect('/custom-order');
    }
});

app.get('/admin/custom-orders', async (req, res) => {
    try {
        if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
        const orders = await CustomOrder.find().sort({ date: -1 });
        res.render('admin-custom-orders', { orders });
    } catch (err) {
        res.send("Error loading custom orders.");
    }
});

app.post('/admin/custom-orders/:id/status', async (req, res) => {
    try {
        if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
        await CustomOrder.findByIdAndUpdate(req.params.id, { status: req.body.status });
        res.redirect('/admin/custom-orders');
    } catch (err) {
        res.send("Error updating status.");
    }
});

// ==========================================
//             NEWSLETTER SUBSCRIBE LOGIC
// ==========================================
app.post('/subscribe', async (req, res) => {
    try {
        const { email } = req.body;
        
        const existingSubscriber = await Subscriber.findOne({ email: email });
        
        if (!existingSubscriber) {
            const newSubscriber = new Subscriber({ email: email });
            await newSubscriber.save();
        }
        
        res.send("<script>alert('Thank you for subscribing to our Newsletter!'); window.location.href='/';</script>");
    } catch (err) {
        console.log("Newsletter Error:", err);
        res.redirect('back');
    }
});

app.get('/admin/subscribers', async (req, res) => {
    try {
        if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
        
        const subscribers = await Subscriber.find().sort({ subscribedAt: -1 });
        res.render('admin-subscribers', { subscribers });
    } catch (err) {
        res.send("Error loading subscribers.");
    }
});

// ==========================================
// CONTACT US & ENQUIRY LOGIC 
// ==========================================

app.get('/contact', (req, res) => res.render('contact'));

app.post('/contact', async (req, res) => {
    try {
        const { name, phone, email, subject, message } = req.body;
        const newEnquiry = new Enquiry({ name, phone, email, subject, message });
        await newEnquiry.save();
        
        res.send("<script>alert('Your message has been sent successfully! We will contact you soon.'); window.location.href='/contact';</script>");
    } catch (err) {
        console.log("Enquiry Error:", err);
        res.send("<script>alert('Error sending message. Please try again.'); window.location.href='/contact';</script>");
    }
});

app.get('/admin/enquiries', async (req, res) => {
    try {
        if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
        
        const enquiries = await Enquiry.find().sort({ createdAt: -1 });
        res.render('admin-enquiries', { enquiries });
    } catch (err) {
        res.send("Error loading enquiries.");
    }
});

app.post('/admin/enquiries/:id/status', async (req, res) => {
    try {
        if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
        await Enquiry.findByIdAndUpdate(req.params.id, { status: req.body.status });
        res.redirect('/admin/enquiries');
    } catch (err) {
        res.redirect('/admin/enquiries');
    }
});

// ==========================================
//             STATIC PAGES
// ==========================================

app.get('/about', (req, res) => res.render('about'));

// Chatbot ke liye Data API Route
app.get('/api/site-data', async (req, res) => {
    try {
        const products = await Product.find({});
        // Agar gold price ka model nahi banaya hai, toh is line ko hata dena ya hardcode kar dena
        // const goldPrice = await GoldPrice.findOne().sort({ updatedAt: -1 }); 
        
        res.json({
            storeName: "Shree Mahalakshmi Jewellers",
            description: "A premium jewellery store offering Gold, Silver, and Custom Designs.",
            liveGoldPrice: "Contact for today's live rate", // Ya goldPrice variable use karo
            availableProducts: products.map(p => ({ name: p.name, category: p.category, price: p.price })),
            contact: "support.smjewellers@gmail.com"
        });
    } catch (err) {
        res.status(500).json({ error: "Data not available" });
    }
});
// === API FOR BOTPRESS CHATBOT (UPDATED FOR CAROUSEL CARDS) ===
app.get('/api/bot/products', async (req, res) => {
    try {
        const query = req.query.q || ''; 
        
        const products = await Product.find({
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { category: { $regex: query, $options: 'i' } }
            ]
        }).limit(5);

        // Agar koi product na mile, toh Botpress ko empty array [] bhejo
        if(products.length === 0) {
             return res.json([]); 
        }

        // Card ke format me data set karo (JSON Array)
        const botData = products.map(p => ({
            name: p.name,
            image: `https://sm-jewellers.onrender.com${p.imagePath}`,
            url: `https://sm-jewellers.onrender.com/product/${p._id}`
        }));

        // Pura data ek sath Botpress ko bhej do
        res.json(botData); 
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});
// --- SERVER START ---
app.listen(PORT, () => {
    console.log(`Server start  http://localhost:${PORT}`);
});