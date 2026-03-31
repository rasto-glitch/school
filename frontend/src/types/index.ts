export type Role = 'parent' | 'teacher' | 'admin' | 'driver' | 'supervisor';

export interface School {
  id: string;
  name: string;
  slug: string;
  abbreviation?: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  features?: Record<string, boolean>;
}

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  firstName: string;
  lastName: string;
  profilePicture?: string;
}

export interface Student {
  id: string;
  fullName: string;
  profilePicture?: string;
  classId?: string;
  classes?: { name: string };
  parentId?: string;
  driverId?: string;
  homeAddress?: string;
  homeLatitude?: number;
  homeLongitude?: number;
  emergencyContact?: string;
  phoneNumber?: string;
  isGraduated?: boolean;
  parents?: { fullName: string; phoneNumber: string; userId?: string };
  drivers?: { fullName: string; phoneNumber?: string; licenseNumber?: string; vehicleType?: 'bus' | 'taxi'; buses?: { busNumber: string } };
}

export interface Teacher {
  id: string;
  fullName: string;
  phoneNumber?: string;
  subject?: string;
  emergencyContact?: string;
  profilePicture?: string;
  teacherClasses?: { classId: string; classes: { name: string } }[];
}

export interface Driver {
  id: string;
  fullName: string;
  phoneNumber?: string;
  emergencyContact?: string;
  licenseNumber?: string;
  vehicleType?: 'bus' | 'taxi';
  busId?: string;
  buses?: { busNumber: string; plateNumber?: string };
  age?: number;
  profilePicture?: string;
}

export interface Class {
  id: string;
  name: string;
  gradeLevel?: string;
  academicYear?: string;
}

export interface Homework {
  id: string;
  title: string;
  description?: string;
  attachmentUrl?: string;
  dueDate?: string;
  subject?: string;
  createdAt: string;
  classId: string;
  classes?: { name: string };
}

export interface Assignment {
  id: string;
  title: string;
  description?: string;
  grade?: number;
  submissionStatus: 'pending' | 'submitted' | 'graded';
  dueDate?: string;
  subject?: string;
  attachmentUrl?: string;
  createdAt: string;
  students?: { fullName: string };
  classes?: { name: string };
}

export interface Grade {
  id: string;
  subject: string;
  dailyGrade: number;
  quizGrade: number;
  monthlyExamGrade: number;
  termExamGrade: number;
  gradingPeriod?: string;
  academicYear?: string;
  createdAt: string;
}

export interface Report {
  id: string;
  subject: string;
  attendanceNotes?: string;
  behaviorNotes?: string;
  quizMarks?: number;
  examMarks?: number;
  teacherNotes?: string;
  reportDate?: string;
  createdAt: string;
  students?: { fullName: string };
  teachers?: { fullName: string };
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  targetAudience: string;
  attachmentUrl?: string;
  linkUrl?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  notificationType: string;
  relatedId?: string;
  createdAt: string;
}

export interface BusLocation {
  id: string;
  driverId: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  isDriving: boolean;
  recordedAt: string;
  drivers?: { fullName: string; phoneNumber?: string; licenseNumber?: string; buses?: { busNumber: string } };
}

export interface Appointment {
  id: string;
  parentId: string;
  reason?: string;
  message?: string;
  requestedDate?: string;
  responseMessage?: string;
  scheduledDate?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  parents?: { fullName: string; phoneNumber: string };
}

export interface Attendance {
  id: string;
  studentId: string;
  classId: string;
  teacherId?: string;
  date: string;
  status: 'present' | 'absent' | 'late';
  notes?: string;
  createdAt: string;
  students?: { id: string; fullName: string; profilePicture?: string; classes?: { name: string }; parents?: { fullName: string; phoneNumber: string } };
  teachers?: { fullName: string };
}

export interface WeeklySummary {
  id: string;
  subject: string;
  unit?: string;
  lesson?: string;
  pages?: string;
  homeworkReminder?: string;
  weekStartDate?: string;
}
