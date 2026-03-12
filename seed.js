const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Class = require('./models/Class');
const Attendance = require('./models/Attendance');
const dotenv = require('dotenv');

dotenv.config();

const seedData = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB for seeding');

    // Clear existing data
    await User.deleteMany({});
    await Class.deleteMany({});
    await Attendance.deleteMany({});

    // Create Teacher
    const teacher = new User({
      name: 'Dr. John Smith',
      email: 'teacher@example.com',
      password: 'password123',
      role: 'teacher'
    });
    await teacher.save();

    // Create Students
    const student1 = new User({
      name: 'Alice Johnson',
      email: 'alice@example.com',
      password: 'password123',
      role: 'student'
    });
    await student1.save();

    const student2 = new User({
      name: 'Bob Wilson',
      email: 'bob@example.com',
      password: 'password123',
      role: 'student'
    });
    await student2.save();

    // Create Class
    const mathClass = new Class({
      name: 'Mathematics 101',
      section: 'A',
      teacher: teacher._id,
      students: [student1._id, student2._id]
    });
    await mathClass.save();

    console.log('Sample data seeded successfully!');
    console.log('Teacher: teacher@example.com / password123');
    console.log('Student: alice@example.com / password123');

    mongoose.connection.close();
  } catch (err) {
    console.error('Seeding failed:', err);
  }
};

seedData();
