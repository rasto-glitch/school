import { supervisorApi } from '../../services/api';
import SalaryScreen from '../shared/SalaryScreen';

// Identical to the teacher salary screen — shares the same body component.
export default function SupervisorSalaryScreen() {
  return <SalaryScreen fetchSalary={supervisorApi.getSalary} />;
}
