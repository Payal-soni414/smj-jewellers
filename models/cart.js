// Cart Model
// Import Mongoose
const mongoose = require('mongoose');
// Define Cart Schema
const cartSchema = new mongoose.Schema({
    // Reference to the User owning the cart
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    items: [{
        productId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'Product', 
            required: true 
        },
        quantity: { 
            type: Number, 
            default: 1 
        }
    }]
});
// Export the Cart model
module.exports = mongoose.model('Cart', cartSchema);
