import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import SchoolPickerScreen from '../screens/auth/SchoolPickerScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import ParentTabs from './ParentTabs';
import DriverTabs from './DriverTabs';
import SetPickupLocationScreen from '../screens/parent/SetPickupLocationScreen';
import MeScreen from '../screens/parent/MeScreen';

export type RootStackParamList = {
  SchoolPicker: undefined;
  Login: undefined;
  ParentTabs: undefined;
  DriverTabs: undefined;
  SetPickupLocation: undefined;
  Me: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function Navigation() {
  const { user, isAuthenticated, selectedSchool } = useAuthStore();
  const authed = isAuthenticated();

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!authed ? (
          !selectedSchool ? (
            <Stack.Screen name="SchoolPicker" component={SchoolPickerScreen} />
          ) : (
            <Stack.Screen name="Login" component={LoginScreen} />
          )
        ) : user?.role === 'driver' ? (
          <Stack.Screen name="DriverTabs" component={DriverTabs} />
        ) : (
          <>
            <Stack.Screen name="ParentTabs" component={ParentTabs} />
            <Stack.Screen name="SetPickupLocation" component={SetPickupLocationScreen} />
            <Stack.Screen
              name="Me"
              component={MeScreen}
              options={{
                headerShown: true,
                headerTitle: 'My Profile',
                headerBackTitle: 'Back',
                presentation: 'card',
              }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
