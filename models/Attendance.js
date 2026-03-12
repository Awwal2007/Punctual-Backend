const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'QRSession', required: true },
  timestamp: { type: Date, default: Date.now },
});

// Prevent duplicate attendance for the same student in the same session
attendanceSchema.index({ student: 1, session: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
