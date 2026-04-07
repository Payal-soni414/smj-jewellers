const mongoose = require('mongoose');
// Order Schema
const orderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, 
        productName: String,
        productImage: String,
        quantity: Number,
        price: Number
    }],
    totalAmount: { type: Number, required: true },
    shippingAddress: {
        fullName: String,
        phone: String,
        street: String,
        city: String,
        state: String,
        pincode: String
    },
    paymentMethod: { type: String, default: 'COD' }, // Cash on Delivery
    paymentStatus: { type: String, default: 'Pending' },
    orderStatus: { type: String, default: 'Processing' }, // Processing, Shipped, Delivered, Cancelled
    
    orderDate: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);