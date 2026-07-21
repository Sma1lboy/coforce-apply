import * as React from 'react';
import { browser } from 'webextension-polyfill-ts';
import * as Tabs from '@radix-ui/react-tabs';
import { profileToForm, formToProfile } from '@utils/profileConverters';
import Logo from '@/components/Logo';
import { UserProfile, UserProfileForm } from '@/types';
import { ProfileTab, TemplateTab, JobDescriptionTab } from './tabs';
import OptionsAppSettings from './OptionsAppSettings';

// Improved debounce function that allows input modifications during pending operations
// and includes a cancel method for flexibility
const debounce = <F extends (...args: any[]) => Promise<any>>(
  func: F,
  waitFor: number
) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let latestArgs: Parameters<F> | null = null;

  const debouncedFunc = (...args: Parameters<F>): void => {
    // Always update the latest args
    latestArgs = args;

    // Clear any existing timeout
    if (timeout !== null) {
      clearTimeout(timeout);
    }

    // Schedule a new operation with the latest args
    timeout = setTimeout(async () => {
      if (latestArgs) {
        const argsToUse = latestArgs;
        latestArgs = null; // Clear latest args

        try {
          await func(...argsToUse); // Execute with the latest args
        } catch (error) {
          console.error('Error in debounced function:', error);
        }
      }
    }, waitFor);
  };

  // Add a cancel method to clear the timeout
  (debouncedFunc as any).cancel = () => {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    latestArgs = null;
  };

  return debouncedFunc as ((...args: Parameters<F>) => void) & {
    cancel: () => void;
  };
};

const Options: React.FC = () => {
  // Tab state for switching between manual input and JSON import
  const [inputMethod, setInputMethod] = React.useState<string>('manual');

  // JSON import state
  const [jsonInput, setJsonInput] = React.useState<string>('');
  const [jsonError, setJsonError] = React.useState<string>('');

  const [profile, setProfile] = React.useState<UserProfileForm>({
    name: '',
    title: '',
    email: '',
    phone: '',
    location: '',
    linkedin: '',
    github: '',
    website: '',
    summary: '',
    skills: '',
    courses: '',
    experience: '',
    education: '',
    certifications: '',
    languages: '',
    projects: '',
  });

  const [status, setStatus] = React.useState<string>('');
  const [autoSaveStatus, setAutoSaveStatus] = React.useState<string>('');

  // Load profile on component mount
  React.useEffect(() => {
    loadProfile();
  }, []);

  // Load user profile from storage
  const loadProfile = async (): Promise<void> => {
    try {
      const data = await browser.storage.local.get('userProfile');
      if (data.userProfile) {
        // Parse the stored data
        let userProfile = JSON.parse(data.userProfile) as Partial<UserProfile>; // Parse as Partial initially

        // Ensure required fields have defaults, especially the newly added 'courses'
        userProfile = {
          ...userProfile, // Keep existing data
          name: userProfile.name ?? '',
          title: userProfile.title ?? '',
          email: userProfile.email ?? '',
          phone: userProfile.phone ?? '',
          location: userProfile.location ?? '',
          summary: userProfile.summary ?? '',
          skills: userProfile.skills ?? [],
          experience: userProfile.experience ?? [],
          education: userProfile.education ?? [],
          courses: userProfile.courses ?? [], // Add default empty array for courses
          projects: userProfile.projects ?? [], // Add default empty array for projects
          // Optional fields like linkedin, github, website, certifications, languages are handled
        };

        // Now convert the guaranteed-to-be-complete UserProfile to UserProfileForm
        const formattedProfile = profileToForm(userProfile as UserProfile);

        setProfile(formattedProfile);
      } else {
        // Handle case where no profile exists in storage yet
        // Optionally set a default empty profile form state here
        setProfile({
          name: '',
          title: '',
          email: '',
          phone: '',
          location: '',
          linkedin: '',
          github: '',
          website: '',
          summary: '',
          skills: '',
          courses: '',
          experience: '[]', // Default to empty JSON array string
          education: '[]',
          projects: '[]',
          certifications: '[]',
          languages: '[]',
        });
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      setStatus('Error loading profile');
      // Optionally set default empty profile on error too
    }
  };

  // Save profile with auto-save feedback
  const saveProfileWithFeedback = async (
    profileToSave: UserProfileForm
  ): Promise<void> => {
    try {
      // Convert UserProfileForm to UserProfile using utility function
      const storageProfile = formToProfile(profileToSave);

      await browser.storage.local.set({
        userProfile: JSON.stringify(storageProfile),
      });

      // Show auto-save status
      setAutoSaveStatus('Profile auto-saved');
      setTimeout(() => setAutoSaveStatus(''), 2000);
    } catch (error) {
      console.error('Error auto-saving profile:', error);
      setAutoSaveStatus('Auto-save failed');
      setTimeout(() => setAutoSaveStatus(''), 3000);
    }
  };

  // Debounced save function
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSaveProfile = React.useCallback(
    debounce(saveProfileWithFeedback, 1500),
    []
  );

  // Auto-save functionality with debounce - update state and schedule a save
  const updateProfileStateWithAutoSave = React.useCallback(
    (updatedProfile: UserProfileForm) => {
      // Update state immediately
      setProfile(updatedProfile);

      // Schedule debounced save
      debouncedSaveProfile(updatedProfile);
    },
    [debouncedSaveProfile]
  );

  // Handle profile field changes with auto-save
  const handleProfileChangeWithAutoSave = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ): void => {
    const { name, value } = e.target;
    const updatedProfile = {
      ...profile,
      [name]: value,
    };

    // Update state and schedule auto-save
    updateProfileStateWithAutoSave(updatedProfile);
  };

  // Handle input field blur event - save immediately when user leaves a field
  const handleProfileBlur = async (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>
  ): Promise<void> => {
    // Cancel any pending debounced saves
    debouncedSaveProfile.cancel?.();

    // Save immediately
    await saveProfileWithFeedback(profile);
  };

  // Handle profile field changes - only update state, don't save
  const handleProfileChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ): void => {
    const { name, value } = e.target;
    const updatedProfile = {
      ...profile,
      [name]: value,
    };
    // Only update state, don't save to storage
    setProfile(updatedProfile);
  };

  // Handle JSON input changes
  const handleJsonInputChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ): void => {
    setJsonInput(e.target.value);
    setJsonError('');
  };

  // Import profile from JSON
  const importProfileFromJson = async (): Promise<void> => {
    try {
      if (!jsonInput.trim()) {
        setJsonError('Please enter JSON data');
        return;
      }

      const jsonData = JSON.parse(jsonInput);

      const requiredFields = [
        'name',
        'title',
        'email',
        'skills',
        'experience',
        'education',
      ];
      const missingFields = requiredFields.filter(field => !jsonData[field]);

      if (missingFields.length > 0) {
        setJsonError(`Missing required fields: ${missingFields.join(', ')}`);
        return;
      }

      const newProfile: UserProfileForm = {
        name: jsonData.name,
        title: jsonData.title,
        email: jsonData.email,
        phone: jsonData.phone || '',
        location: jsonData.location || '',
        linkedin: jsonData.linkedin || '',
        github: jsonData.github || '',
        website: jsonData.website || '',
        summary: jsonData.summary || '',
        skills: Array.isArray(jsonData.skills)
          ? jsonData.skills.join(', ')
          : jsonData.skills,
        courses: Array.isArray(jsonData.courses)
          ? jsonData.courses.join(', ')
          : jsonData.courses || '',
        experience: JSON.stringify(jsonData.experience || [], null, 2),
        education: JSON.stringify(jsonData.education || [], null, 2),
        certifications: JSON.stringify(jsonData.certifications || [], null, 2),
        languages: JSON.stringify(jsonData.languages || [], null, 2),
        projects: JSON.stringify(jsonData.projects || [], null, 2),
      };

      setProfile(newProfile);

      try {
        // Convert UserProfileForm to UserProfile
        const storageProfile = formToProfile(newProfile);

        await browser.storage.local.set({
          userProfile: JSON.stringify(storageProfile),
        });

        setStatus('Profile imported and saved successfully!');
      } catch (storageError) {
        console.error(
          'Error saving imported profile to storage:',
          storageError
        );
        setStatus(
          `Profile imported but not saved: ${
            storageError instanceof Error
              ? storageError.message
              : 'Unknown error'
          }`
        );
      }

      setTimeout(() => setStatus(''), 3000);

      // Switch to manual input tab to show the imported data
      setInputMethod('manual');
    } catch (error) {
      console.error('Error importing profile from JSON:', error);
      setJsonError(
        `Invalid JSON format: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 font-sans">
      <h1 className="text-2xl font-bold mb-6 text-center text-gray-800 flex items-center justify-center">
        CoForce Apply Settings
        <Logo size="6" className="ml-2" />
      </h1>

      {status && (
        <div className="bg-green-500 text-white p-3 mb-6 rounded text-center">
          {status}
        </div>
      )}

      {autoSaveStatus && (
        <div className="bg-secondary-500 text-white p-2 mb-4 rounded text-center text-sm fixed bottom-4 right-4 z-50 shadow-md">
          {autoSaveStatus}
        </div>
      )}

      <div className="border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <Tabs.Root
          value={inputMethod}
          onValueChange={setInputMethod}
          className="w-full"
        >
          <Tabs.List className="flex bg-gray-100 border-b border-gray-200">
            <Tabs.Trigger
              value="manual"
              className="px-4 py-3 font-medium data-[state=active]:bg-white data-[state=active]:text-primary-700 data-[state=active]:border-b-2 data-[state=active]:border-primary-500 data-[state=inactive]:text-gray-600 data-[state=inactive]:hover:bg-gray-200"
            >
              Profile
            </Tabs.Trigger>
            <Tabs.Trigger
              value="template"
              className="px-4 py-3 font-medium data-[state=active]:bg-white data-[state=active]:text-primary-700 data-[state=active]:border-b-2 data-[state=active]:border-primary-500 data-[state=inactive]:text-gray-600 data-[state=inactive]:hover:bg-gray-200"
            >
              Template
            </Tabs.Trigger>
            <Tabs.Trigger
              value="jobDescription"
              className="px-4 py-3 font-medium data-[state=active]:bg-white data-[state=active]:text-primary-700 data-[state=active]:border-b-2 data-[state=active]:border-primary-500 data-[state=inactive]:text-gray-600 data-[state=inactive]:hover:bg-gray-200"
            >
              Job Description
            </Tabs.Trigger>
            <Tabs.Trigger
              value="settings"
              className="px-4 py-3 font-medium data-[state=active]:bg-white data-[state=active]:text-primary-700 data-[state=active]:border-b-2 data-[state=active]:border-primary-500 data-[state=inactive]:text-gray-600 data-[state=inactive]:hover:bg-gray-200"
            >
              Settings
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="manual" className="bg-white p-6">
            <ProfileTab
              profile={profile}
              onProfileChange={handleProfileChangeWithAutoSave}
              onProfileUpdate={updateProfileStateWithAutoSave}
              onStatusChange={setStatus}
              jsonInput={jsonInput}
              jsonError={jsonError}
              onJsonInputChange={handleJsonInputChange}
              onImportProfile={importProfileFromJson}
              onProfileBlur={handleProfileBlur}
            />
          </Tabs.Content>

          <Tabs.Content value="template" className="bg-white p-6">
            <TemplateTab onStatusChange={setStatus} />
          </Tabs.Content>

          <Tabs.Content value="jobDescription" className="bg-white p-6">
            <JobDescriptionTab onStatusChange={setStatus} />
          </Tabs.Content>

          <Tabs.Content value="settings" className="bg-white p-6">
            <OptionsAppSettings />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  );
};

export default Options;
