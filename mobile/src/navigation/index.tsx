import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import LoginScreen from '../screens/auth/LoginScreen';
import ParentTabs from './ParentTabs';
import DriverTabs from './DriverTabs';

export type RootStackParamList = {
  Login: undefined;
  ParentTabs: undefined;
  DriverTabs: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function Navigation() {
  const { user, isAuthenticated } = useAuthStore();
  const authed = isAuthenticated();

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!authed ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : user?.role === 'driver' ? (
          <Stack.Screen name="DriverTabs" component={DriverTabs} />
        ) : (
          <Stack.Screen name="ParentTabs" component={ParentTabs} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
