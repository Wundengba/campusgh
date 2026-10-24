import { useState, useEffect, useContext } from 'react';
import { SettingsContext } from '../../../context/SettingsContext';

/**
 * Custom hook for School 1 specific data and functionality
 * This hook provides school-specific data fetching and state management
 */
export const useSchool1Data = () => {
  const { cfg } = useContext(SettingsContext);
  const [schoolStats, setSchoolStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch school-specific statistics
  useEffect(() => {
    const fetchSchoolStats = async () => {
      try {
        setLoading(true);

        // Simulate API call for school-specific data
        // In a real implementation, this would call your backend API
        const mockStats = {
          totalStudents: 450,
          activeClasses: 24,
          todayAttendance: 92,
          topPerformingClass: 'SHS 3A',
          upcomingEvents: [
            { title: 'Science Fair', date: '2024-02-15', type: 'academic' },
            { title: 'Sports Day', date: '2024-02-20', type: 'sports' },
            { title: 'Parent-Teacher Conference', date: '2024-02-25', type: 'meeting' }
          ],
          recentAchievements: [
            'School won regional debate competition',
            '3 students qualified for national science Olympiad',
            'Art club exhibition received 200+ visitors'
          ]
        };

        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 1000));

        setSchoolStats(mockStats);
        setError(null);
      } catch (err) {
        setError('Failed to load school data');
        console.error('Error fetching school stats:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSchoolStats();
  }, []);

  // School-specific utility functions
  const getClassPerformance = (className) => {
    // Mock performance data - in real app, this would come from API
    const performanceData = {
      'JHS 1': { average: 78, topSubject: 'Mathematics', improvement: '+5%' },
      'JHS 2': { average: 82, topSubject: 'English', improvement: '+3%' },
      'JHS 3': { average: 79, topSubject: 'Science', improvement: '+7%' },
      'SHS 1': { average: 75, topSubject: 'Mathematics', improvement: '+2%' },
      'SHS 2': { average: 81, topSubject: 'English', improvement: '+4%' },
      'SHS 3': { average: 85, topSubject: 'Science', improvement: '+6%' }
    };

    return performanceData[className] || { average: 0, topSubject: 'N/A', improvement: '0%' };
  };

  const getUpcomingDeadlines = () => {
    const now = new Date();
    const deadlines = [
      {
        title: 'Mid-term Examinations',
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14),
        type: 'exam',
        priority: 'high'
      },
      {
        title: 'Assignment Submission',
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7),
        type: 'assignment',
        priority: 'medium'
      },
      {
        title: 'Project Presentation',
        date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21),
        type: 'project',
        priority: 'high'
      }
    ];

    return deadlines.filter(deadline => deadline.date > now);
  };

  const getSchoolAnnouncements = () => {
    return [
      {
        id: 1,
        title: 'New Library Hours',
        content: 'The school library will now be open until 6 PM on weekdays.',
        date: '2024-01-15',
        priority: 'low'
      },
      {
        id: 2,
        title: 'Sports Team Tryouts',
        content: 'Tryouts for basketball and soccer teams start next week.',
        date: '2024-01-12',
        priority: 'medium'
      },
      {
        id: 3,
        title: 'Parent-Teacher Meeting',
        content: 'Scheduled for February 25th. Please confirm attendance.',
        date: '2024-01-10',
        priority: 'high'
      }
    ];
  };

  return {
    schoolStats,
    loading,
    error,
    getClassPerformance,
    getUpcomingDeadlines,
    getSchoolAnnouncements,
    // School-specific configuration
    schoolConfig: {
      name: 'School 1',
      theme: 'blue',
      features: ['custom-dashboard', 'advanced-analytics', 'parent-portal']
    }
  };
};

export default useSchool1Data;