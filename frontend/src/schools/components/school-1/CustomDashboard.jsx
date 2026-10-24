import React from 'react';

/**
 * Custom Dashboard Component for School 1
 * This component demonstrates how schools can have their own custom dashboard layouts
 */
const CustomDashboard = ({ user, stats, recentActivity }) => {
  return (
    <div className="school-1-dashboard">
      <div className="welcome-header" style={{
        background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
        color: 'white',
        padding: '2rem',
        borderRadius: '12px',
        marginBottom: '2rem'
      }}>
        <h1>Welcome to {user?.managed_school_name || 'School 1'}</h1>
        <p>Excellence in Education - Your personalized dashboard</p>
      </div>

      <div className="dashboard-grid">
        {/* Quick Stats */}
        <div className="stats-card">
          <h3>Total Students</h3>
          <div className="stat-number">{stats?.totalStudents || 0}</div>
        </div>

        <div className="stats-card">
          <h3>Active Classes</h3>
          <div className="stat-number">{stats?.activeClasses || 0}</div>
        </div>

        <div className="stats-card">
          <h3>Today's Attendance</h3>
          <div className="stat-number">{stats?.todayAttendance || 0}%</div>
        </div>

        {/* Recent Activity - School Specific */}
        <div className="activity-card">
          <h3>School News & Updates</h3>
          <div className="activity-list">
            {recentActivity?.map((activity, index) => (
              <div key={index} className="activity-item">
                <div className="activity-icon">📚</div>
                <div className="activity-content">
                  <div className="activity-title">{activity.title}</div>
                  <div className="activity-time">{activity.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* School-specific features */}
        <div className="school-features">
          <h3>School Features</h3>
          <div className="feature-grid">
            <div className="feature-item">
              <span className="feature-icon">🎓</span>
              <span>Advanced Analytics</span>
            </div>
            <div className="feature-item">
              <span className="feature-icon">👨‍👩‍👧‍👦</span>
              <span>Parent Portal</span>
            </div>
            <div className="feature-item">
              <span className="feature-icon">📱</span>
              <span>Mobile App</span>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .school-1-dashboard {
          padding: 1rem;
        }

        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1.5rem;
        }

        .stats-card, .activity-card, .school-features {
          background: white;
          border-radius: 12px;
          padding: 1.5rem;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }

        .stats-card {
          text-align: center;
          border-left: 4px solid #1e40af;
        }

        .stat-number {
          font-size: 2.5rem;
          font-weight: bold;
          color: #1e40af;
          margin-top: 0.5rem;
        }

        .activity-list {
          margin-top: 1rem;
        }

        .activity-item {
          display: flex;
          align-items: center;
          padding: 0.75rem 0;
          border-bottom: 1px solid #f1f5f9;
        }

        .activity-item:last-child {
          border-bottom: none;
        }

        .activity-icon {
          font-size: 1.5rem;
          margin-right: 1rem;
        }

        .activity-title {
          font-weight: 600;
          color: #1e40af;
        }

        .activity-time {
          font-size: 0.875rem;
          color: #64748b;
          margin-top: 0.25rem;
        }

        .feature-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1rem;
          margin-top: 1rem;
        }

        .feature-item {
          display: flex;
          align-items: center;
          padding: 0.75rem;
          background: #f8fafc;
          border-radius: 8px;
        }

        .feature-icon {
          font-size: 1.25rem;
          margin-right: 0.75rem;
        }
      `}</style>
    </div>
  );
};

export default CustomDashboard;