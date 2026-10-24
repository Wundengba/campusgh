# School-Specific Organization

This folder contains school-specific configurations, components, assets, and utilities for the Campus Ghana application.

## Folder Structure

```
schools/
├── config/          # School-specific configuration files
├── components/      # School-specific React components
├── assets/          # School-specific images, logos, styles
├── data/            # School-specific data and constants
├── utils/           # School-specific utility functions
└── hooks/           # School-specific React hooks
```

## Usage

### Adding a New School

1. Create a subfolder in each directory with the school ID or a normalized name
2. Add school-specific configurations in `config/`
3. Create school-specific components in `components/`
4. Store school assets in `assets/`
5. Add school-specific data in `data/`
6. Create utility functions in `utils/`
7. Add custom hooks in `hooks/`

### Example Structure for a School

```
schools/
├── config/
│   └── school-1/
│       └── theme.js
├── components/
│   └── school-1/
│       └── CustomDashboard.jsx
├── assets/
│   └── school-1/
│       ├── logo.png
│       └── styles.css
├── data/
│   └── school-1/
│       └── subjects.js
├── utils/
│   └── school-1/
│       └── formatters.js
└── hooks/
    └── school-1/
        └── useSchoolData.js
```

## Dynamic Loading

School-specific modules can be dynamically loaded based on the current user's registered school:

```javascript
import { useContext } from 'react';
import { SettingsContext } from '../context/SettingsContext';

// Get current school ID
const { user } = useContext(SettingsContext);
const schoolId = user?.registered_school_id;

// Dynamically import school-specific component
const SchoolComponent = await import(`../schools/components/${schoolId}/CustomComponent.jsx`);
```

## Best Practices

1. Use school IDs as folder names for consistency
2. Keep shared functionality in the main application folders
3. Use school-specific folders only for truly school-specific features
4. Document school-specific customizations clearly
5. Test school-specific features across different schools