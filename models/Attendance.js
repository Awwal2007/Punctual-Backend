const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  qrSession: { type: mongoose.Schema.Types.ObjectId, ref: 'QRSession', required: true },
  timestamp: { type: Date, default: Date.now },
});

// Prevent duplicate attendance for the same worker in the same session(QR)
attendanceSchema.index({ worker: 1, qrSession: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
