const express = require('express');
const router = express.Router();
const Class = require('../models/Class');
const { auth, authorize } = require('../middleware/auth');

// @route   POST api/classes
// @desc    Create a new class (Teacher only)
router.post('/', auth, authorize('teacher'), async (req, res) => {
  const { name, section } = req.body;
  try {
    const newClass = new Class({
      name,
      section,
      teacher: req.user.id
    });
    await newClass.save();
    res.json(newClass);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/classes
// @desc    Get all classes for a user (Teacher: owned, Student: enrolled)
router.get('/', auth, async (req, res) => {
  try {
    let classes;
    if (req.user.role === 'teacher') {
      classes = await Class.find({ teacher: req.user.id }).populate('students', 'name email');
    } else {
      classes = await Class.find({ students: req.user.id });
    }
    res.json(classes);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/classes/:id/enroll
// @desc    Enroll a student in a class (Teacher adds student)
router.post('/:id/enroll', auth, authorize('teacher'), async (req, res) => {
  const { studentEmail } = req.body;
  const User = require('../models/User');
  try {
    const student = await User.findOne({ email: studentEmail, role: 'student' });
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const targetClass = await Class.findById(req.params.id);
    if (!targetClass) return res.status(404).json({ message: 'Class not found' });

    if (targetClass.students.includes(student.id)) {
      return res.status(400).json({ message: 'Student already enrolled' });
    }

    targetClass.students.push(student.id);
    await targetClass.save();
    res.json(targetClass);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/classes/:id/join
// @desc    Student self-enrollment (Join class)
router.post('/:id/join', auth, authorize('student'), async (req, res) => {
  const { sendNotification } = require('../utils/notifications');
  const User = require('../models/User');
  try {
    const targetClass = await Class.findById(req.params.id).populate('teacher', 'name fcmTokens');
    if (!targetClass) return res.status(404).json({ message: 'Class not found' });

    if (targetClass.students.includes(req.user.id)) {
      return res.status(400).json({ message: 'You are already enrolled in this class' });
    }

    targetClass.students.push(req.user.id);
    await targetClass.save();

    // Notify Teacher
    try {
      const student = await User.findById(req.user.id);
      if (targetClass.teacher && targetClass.teacher.fcmTokens?.length > 0) {
        await sendNotification(targetClass.teacher.fcmTokens, {
          title: 'New Student Joined! 🎓',
          body: `${student.name} has joined your class: ${targetClass.name}`
        });
      }
      
      // Notify Student
      if (student.fcmTokens?.length > 0) {
        await sendNotification(student.fcmTokens, {
          title: 'Successfully Joined! ✅',
          body: `You are now registered for ${targetClass.name}`
        });
      }
    } catch (notifyErr) {
      console.error('Enrollment notification failed:', notifyErr.message);
    }

    res.json({ message: 'Successfully joined class', class: targetClass });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
