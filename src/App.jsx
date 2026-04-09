import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import VehiclesPage from './pages/VehiclesPage';
import UsersPage from './pages/UsersPage';
import LogsPage from './pages/LogsPage';

function Sidebar() {
  const { user, logout } = useAuth();

  const linkClass = ({ isActive }) =>
    `block px-4 py-2 rounded-md transition-colors ${
      isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
    }`;

  return (
    <aside className="w-64 bg-gray-800 min-h-screen flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-lg font-bold text-white">VIN Dashboard</h2>
        <p className="text-sm text-gray-400 mt-1">{user.name} ({user.role})</p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        <NavLink to="/" end className={linkClass}>Dashboard</NavLink>
        <NavLink to="/files" className={linkClass}>Files</NavLink>
        <NavLink to="/vehicles" className={linkClass}>Vehicles</NavLink>
        {user.role === 'admin' && (
          <NavLink to="/users" className={linkClass}>Users</NavLink>
        )}
      </nav>

      <div className="p-4 border-t border-gray-700">
        <button
          onClick={logout}
          className="w-full px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded-md transition-colors"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}

function DashboardLayout() {
  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 bg-gray-100 min-h-screen p-6">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/files" element={<DashboardPage />} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      {user ? <DashboardLayout /> : <LoginPage />}
    </BrowserRouter>
  );
}
