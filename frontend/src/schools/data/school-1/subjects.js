// School-specific subjects configuration for School 1
// This file contains subjects specific to this school's curriculum

export const SCHOOL_SUBJECTS = [
  'English Language',
  'Mathematics',
  'Integrated Science',
  'Social Studies',
  'Religious & Moral Education',
  'French',
  'Information & Communication Technology',
  'Physical Education',
  'Art & Design',
  'Home Economics',
  'Career Technology',
  'Ghanaian Language (Twi)',
  'Music',
  'Drama'
];

export const SUBJECT_CATEGORIES = {
  core: ['English Language', 'Mathematics', 'Integrated Science', 'Social Studies'],
  elective: ['French', 'Information & Communication Technology', 'Physical Education', 'Art & Design'],
  specialized: ['Home Economics', 'Career Technology', 'Ghanaian Language (Twi)', 'Music', 'Drama']
};

export const SUBJECT_TEACHERS = {
  'English Language': ['Ms. Johnson', 'Mr. Mensah'],
  'Mathematics': ['Mr. Osei', 'Mrs. Boateng'],
  'Integrated Science': ['Dr. Addo', 'Ms. Nkrumah'],
  'Social Studies': ['Mr. Asante', 'Mrs. Owusu'],
  'Religious & Moral Education': ['Rev. Frimpong'],
  'French': ['Mme. Dubois'],
  'Information & Communication Technology': ['Mr. Techie'],
  'Physical Education': ['Coach Amoah'],
  'Art & Design': ['Ms. Creative'],
  'Home Economics': ['Mrs. Domestic'],
  'Career Technology': ['Mr. Practical'],
  'Ghanaian Language (Twi)': ['Mrs. Linguist'],
  'Music': ['Mr. Melody'],
  'Drama': ['Ms. Stage']
};

export default {
  SCHOOL_SUBJECTS,
  SUBJECT_CATEGORIES,
  SUBJECT_TEACHERS
};