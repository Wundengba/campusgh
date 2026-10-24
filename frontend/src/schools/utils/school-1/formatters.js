/**
 * School-specific utility functions for School 1
 * These utilities handle formatting and calculations specific to this school's requirements
 */

// Format student ID with school prefix
export const formatStudentId = (baseId) => {
  return `SCH1-${String(baseId).padStart(4, '0')}`;
};

// Format grades according to school's grading system
export const formatGrade = (score) => {
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
};

// Calculate GPA according to school's system
export const calculateGPA = (grades) => {
  const gradePoints = { A: 4.0, B: 3.0, C: 2.0, D: 1.0, F: 0.0 };
  const totalPoints = grades.reduce((sum, grade) => sum + (gradePoints[grade] || 0), 0);
  return totalPoints / grades.length;
};

// Format currency for school fees (Ghanaian Cedi)
export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS'
  }).format(amount);
};

// Format dates according to school's preferred format
export const formatDate = (date) => {
  return new Intl.DateTimeFormat('en-GH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(new Date(date));
};

// Generate school-specific report card comments
export const generateReportComment = (subject, grade, attendance) => {
  const comments = {
    excellent: [
      "Outstanding performance! Keep up the excellent work.",
      "Exceptional understanding of the subject matter.",
      "Consistently demonstrates mastery of concepts."
    ],
    good: [
      "Good progress shown. Continue to work hard.",
      "Solid understanding with room for improvement.",
      "Consistent effort yielding positive results."
    ],
    needs_improvement: [
      "Additional effort required to reach full potential.",
      "More focus and practice needed in this area.",
      "Improvement needed to meet expectations."
    ]
  };

  let commentSet;
  if (grade === 'A') commentSet = comments.excellent;
  else if (grade === 'B' || grade === 'C') commentSet = comments.good;
  else commentSet = comments.needs_improvement;

  const randomComment = commentSet[Math.floor(Math.random() * commentSet.length)];

  // Add attendance note if needed
  if (attendance < 80) {
    return `${randomComment} Please improve attendance to support learning.`;
  }

  return randomComment;
};

// Validate school email format
export const isValidSchoolEmail = (email) => {
  const schoolEmailRegex = /^[a-zA-Z0-9._%+-]+@school1\.edu\.gh$/;
  return schoolEmailRegex.test(email);
};

// Generate school-specific class schedule
export const generateClassSchedule = (className, term) => {
  // School 1 has a specific schedule structure
  const baseSchedule = {
    'JHS 1': ['8:00-9:00', '9:00-10:00', '10:00-11:00', '11:00-12:00'],
    'JHS 2': ['8:30-9:30', '9:30-10:30', '10:30-11:30', '11:30-12:30'],
    'JHS 3': ['8:00-9:00', '9:00-10:00', '10:00-11:00', '11:00-12:00'],
    'SHS 1': ['7:30-8:30', '8:30-9:30', '9:30-10:30', '10:30-11:30'],
    'SHS 2': ['7:30-8:30', '8:30-9:30', '9:30-10:30', '10:30-11:30'],
    'SHS 3': ['7:30-8:30', '8:30-9:30', '9:30-10:30', '10:30-11:30']
  };

  return baseSchedule[className] || ['8:00-9:00', '9:00-10:00', '10:00-11:00', '11:00-12:00'];
};

export default {
  formatStudentId,
  formatGrade,
  calculateGPA,
  formatCurrency,
  formatDate,
  generateReportComment,
  isValidSchoolEmail,
  generateClassSchedule
};