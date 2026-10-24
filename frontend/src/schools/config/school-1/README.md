# School 1 - Example School Configuration

This folder contains all school-specific configurations, components, assets, and utilities for School 1.

## Overview

School 1 is configured as an example school with the following features:

- **Custom Branding**: Blue color scheme with amber accents
- **Advanced Features**: Custom dashboard, analytics, and parent portal
- **Extended Curriculum**: Additional subjects including Ghanaian Language and specialized electives
- **Custom Grading**: A-F grading system with GPA calculations

## Folder Structure

```
school-1/
├── config/
│   └── index.js              # School configuration and settings
├── components/
│   └── CustomDashboard.jsx   # Custom dashboard component
├── data/
│   └── subjects.js           # School-specific subjects and categories
├── utils/
│   └── formatters.js         # Utility functions for formatting and calculations
├── hooks/
│   └── useSchool1Data.js     # Custom hook for school-specific data
└── assets/
    └── styles.css            # Custom CSS styles for the school
```

## Configuration Details

### Branding
- Primary Color: `#1e40af` (Blue)
- Secondary Color: `#3b82f6` (Light Blue)
- Accent Color: `#f59e0b` (Amber)

### Features Enabled
- Custom Dashboard
- Advanced Analytics
- Parent Portal
- Mobile App Integration

### Curriculum
- Core Subjects: English, Mathematics, Science, Social Studies
- Elective Subjects: French, ICT, Physical Education, Art & Design
- Specialized Subjects: Home Economics, Career Technology, Ghanaian Language

## Usage

### Loading School Configuration
```javascript
import { loadSchoolConfig } from '../../schools';

const config = await loadSchoolConfig('school-1');
console.log(config.branding.primaryColor); // '#1e40af'
```

### Using School Components
```javascript
import { loadSchoolComponent } from '../../schools';

const CustomDashboard = await loadSchoolComponent('school-1', 'CustomDashboard');
// Use CustomDashboard component
```

### Accessing School Data
```javascript
import subjects from './schools/data/school-1/subjects';

console.log(subjects.SCHOOL_SUBJECTS); // Array of subjects
```

### Using School Utilities
```javascript
import { formatStudentId, calculateGPA } from './schools/utils/school-1/formatters';

const studentId = formatStudentId(123); // 'SCH1-0123'
const gpa = calculateGPA(['A', 'B', 'A']); // 3.67
```

### Using School Hooks
```javascript
import { useSchool1Data } from './schools/hooks/school-1/useSchool1Data';

const { schoolStats, loading, getClassPerformance } = useSchool1Data();
```

## Customization

To customize School 1:

1. **Modify Configuration**: Edit `config/index.js`
2. **Update Styling**: Modify `assets/styles.css`
3. **Add Components**: Create new files in `components/`
4. **Extend Data**: Add new data files in `data/`
5. **Add Utilities**: Create utility functions in `utils/`
6. **Create Hooks**: Add custom hooks in `hooks/`

## Integration

School-specific content is loaded dynamically based on the user's registered school. The main application checks for school-specific overrides and loads them when available.

## Notes

- This is a sample implementation demonstrating the school folder structure
- In production, each school would have its own folder with appropriate configurations
- School folders should be created following the naming convention: `school-{id}`
- Assets should be optimized and follow the school's branding guidelines