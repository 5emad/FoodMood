import ReportsTab from './tabs/ReportsTab';
import WeeksTab from './tabs/WeeksTab';
import OrdersTab from './tabs/OrdersTab';
import FoodsTab from './tabs/FoodsTab';
import UsersTab from './tabs/UsersTab';
import DepartmentsTab from './tabs/DepartmentsTab';
import FinanceTab from './tabs/FinanceTab';
import GuestsTab from './tabs/GuestsTab';
import AnnouncementsTab from './tabs/AnnouncementsTab';
import SurveysTab from './tabs/SurveysTab';
import BackupTab from './tabs/BackupTab';

const TABS = {
  reports: ReportsTab,
  weeks: WeeksTab,
  orders: OrdersTab,
  foods: FoodsTab,
  users: UsersTab,
  departments: DepartmentsTab,
  finance: FinanceTab,
  guests: GuestsTab,
  announcements: AnnouncementsTab,
  surveys: SurveysTab,
  backup: BackupTab,
};

export default function AdminTabRouter({ tab, boot, onReportsAccessChange }) {
  const Component = TABS[tab] || ReportsTab;
  const props = {
    ...(tab === 'users' ? { currentUserId: boot?.currentUserId, isSuperadmin: boot?.isSuperadmin } : {}),
    ...(tab === 'orders' ? { onReportsAccessChange } : {}),
  };
  return <Component {...props} />;
}
