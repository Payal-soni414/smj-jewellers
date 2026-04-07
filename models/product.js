const mongoose = require('mongoose');
// Product Schema
const productSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true 
    },
    category: { 
        type: String, 
        required: true, 
        enum: ['Gold', 'Silver', 'Artificial'] 
    },
    weightInGrams: { 
        type: Number, 
        default: 0
    },
    makingCharges: { 
        type: Number, 
        required: true
    },
    imagePath: { 
        type: String,
        default: ''
    },
    description: { 
        type: String,
        default: 'Premium Quality Jewellery'
    },
    isTrending: {
        type: Boolean,
        default: false 
    },
    inStock: {
        type: Boolean,
        default: true
    },
    reviews: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        userName: { type: String, required: true },
        rating: { type: Number, required: true, default: 5 },
        comment: { type: String, required: true },
        date: { type: Date, default: Date.now }
    }]
});

module.exports = mongoose.model('Product', productSchema);