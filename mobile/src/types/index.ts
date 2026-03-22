export type Role = 'parent' | 'teacher' | 'admin' | 'driver' | 'supervisor';

export interface School {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
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
  drivers?: { fullName: string; phoneNumber?: string; licenseNumber?: string; buses?: { busNumber: string } };
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
