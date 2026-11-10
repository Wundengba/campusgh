export const LEARNING_LEVELS = [
  {
    key: "jhs",
    label: "JHS   BECE",
    name: "Junior High School",
    description: "BECE preparation, lesson notes, and past questions.",
  },
  {
    key: "shs",
    label: "SHS   WASSCE",
    name: "Senior High School",
    description: "Clear lessons for WASSCE core and elective subjects.",
  },
  {
    key: "university",
    label: "University",
    name: "University",
    description: "Course materials, study guides, and past questions.",
  },
];

export const LEARNING_RESOURCE_TYPES = [
  { key: "lesson_notes", label: "Lesson notes" },
  { key: "past_questions", label: "Past questions" },
  { key: "course_materials", label: "Course materials" },
  { key: "study_guides", label: "Study guides" },
  { key: "practice", label: "Practice & quizzes" },
];

export const LEARNING_SUBJECTS = {
  jhs: [
    "English Language",
    "Mathematics",
    "Science",
    "Social Studies",
    "Computing",
    "Career Technology",
    "Creative Arts and Design",
    "Religious and Moral Education",
    "Ghanaian Language",
    "French",
  ],
  shs: [
    "English Language (Core)",
    "Core Mathematics",
    "Integrated Science",
    "Social Studies",
    "Elective Mathematics",
    "Biology",
    "Chemistry",
    "Physics",
    "Economics",
    "Geography",
    "Government",
    "History",
    "Literature in English",
    "French",
    "Accounting",
    "Business Management",
    "Cost Accounting",
    "General Agriculture",
    "Animal Husbandry",
    "Food and Nutrition",
    "Management in Living",
    "Clothing and Textiles",
    "Graphic Design",
    "Technical Drawing",
    "Applied Electricity",
    "Building Construction",
    "Woodwork",
    "Metalwork",
    "ICT",
  ],
  university: [
    "Accounting",
    "Agriculture",
    "Business Administration",
    "Communication Studies",
    "Computer Science",
    "Economics",
    "Education",
    "Engineering",
    "Law",
    "Nursing",
    "Public Health",
    "Social Sciences",
  ],
};

export const getLearningLevelFromClass = (className = "") => {
  const normalized = String(className).trim().toLowerCase();
  if (/\b(university|universit|undergraduate|tertiary|college|level [1-6]00)\b/.test(normalized)) {
    return "university";
  }
  if (/\b(jhs|junior high|basic (?:[7-9])|grade [7-9])\b/.test(normalized)) return "jhs";
  if (/\b(shs|senior high|form [1-3])\b/.test(normalized)) return "shs";
  return null;
};

export const getLearningLevelName = (level) =>
  LEARNING_LEVELS.find((item) => item.key === level)?.name || "Junior High School";

export const getLearningResourceLabel = (resourceType) =>
  LEARNING_RESOURCE_TYPES.find((item) => item.key === resourceType)?.label ||
  "Learning material";

export const isLearningLevel = (value) =>
  LEARNING_LEVELS.some((level) => level.key === value);
