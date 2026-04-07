const mongoose = require('mongoose');
// Enquiry Form Schema
const enquirySchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },  
    email: { type: String, required: true },
    subject: { type: String },
    message: { type: String, required: true },
    status: { type: String, default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});
// Export Model
module.exports = mongoose.model('Enquiry', enquirySchema);