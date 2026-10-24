// School-specific configuration for School ID: 1
// This file contains custom settings, themes, and configurations for this specific school

export default {
  // School branding
  branding: {
    primaryColor: '#1e40af', // Blue theme
    secondaryColor: '#f59e0b', // Amber accent
    logo: '/schools/school-1/assets/logo.png',
    schoolName: 'Example School',
    tagline: 'Excellence in Education'
  },

  // Custom features enabled for this school
  features: {
    customDashboard: true,
    advancedAnalytics: true,
    parentPortal: true,
    mobileApp: true
  },

  // School-specific subjects (overrides default)
  subjects: [
    'English Language',
    'Mathematics',
    'Integrated Science',
    'Social Studies',
    'Religious & Moral Education',
    'French',
    'ICT',
    'Physical Education',
    'Art & Design'
  ],

  // Custom grading system
  gradingSystem: {
    A: { min: 80, max: 100, points: 4.0 },
    B: { min: 70, max: 79, points: 3.0 },
    C: { min: 60, max: 69, points: 2.0 },
    D: { min: 50, max: 59, points: 1.0 },
    F: { min: 0, max: 49, points: 0.0 }
  },

  // School-specific settings
  settings: {
    academicYear: '2024/2025',
    terms: ['First Term', 'Second Term', 'Third Term'],
    classStructure: ['JHS 1', 'JHS 2', 'JHS 3', 'SHS 1', 'SHS 2', 'SHS 3'],
    attendanceRequired: true,
    parentNotifications: true
  },

  // Custom API endpoints (if needed)
  api: {
    customReports: '/api/school-1/reports',
    attendanceSync: '/api/school-1/attendance'
  }
};