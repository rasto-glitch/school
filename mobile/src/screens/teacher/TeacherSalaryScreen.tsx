import { teacherApi } from '../../services/api';
import SalaryScreen from '../shared/SalaryScreen';

// Thin wrapper — the screen body is shared with the supervisor salary
// screen so the two never drift. Only the fetcher differs.
export default function TeacherSalaryScreen() {
  return <SalaryScreen fetchSalary={teacherApi.getSalary} />;
}
