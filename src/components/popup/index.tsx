import * as React from 'react';
import { browser, Tabs as BrowserTabs } from 'webextension-polyfill-ts';
import * as Tabs from '@radix-ui/react-tabs';
import { FileText, Settings } from 'lucide-react';
import Logo from '@/components/Logo';
import ApplyTab from '@/components/popup/ApplyTab';
import './popup.css';

import { Input } from '@/components/ui/input';
import { InputField } from '@/components/ui/form-field';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { OpenAISettings, UserProfile } from '@/types';
import {
  defaultOpenAISettings,
  parseOpenAISettings,
  stringifyOpenAISettings,
} from '@/utils/config';
import { openInOverleaf } from '@/utils/overleafIntegration';

function openWebPage(url: string): Promise<BrowserTabs.Tab> {
  return browser.tabs.create({ url });
}

// Removed predefined model options to allow user input
interface ResumeItem {
  id: string;
  date: string;
  content: string;
  preview: string;
  jobDescription: string;
  pageUrl?: string;
  pageTitle?: string;
  metadata?: {
    company: string;
    position: string;
    industry: string;
    location: string;
    keyRequirements: string[];
    // Improved skills structure with categorization
    keySkills: {
      // Group skills by category
      technical?: {
        [category: string]: string[]; // e.g. "programming": ["JavaScript", "TypeScript"]
      };
      soft?: string[]; // Soft skills like "Communication", "Leadership"
      domain?: string[]; // Domain-specific skills like "Financial Analysis"
      tools?: string[]; // Tools and platforms
      uncategorized?: string[]; // Skills that don't fit in other categories
    };
  };
}

const Popup: React.FC = () => {
  const [settings, setSettings] = React.useState<OpenAISettings>(
    defaultOpenAISettings
  );
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [saveStatus, setSaveStatus] = React.useState<string>('');
  const [autoSaveStatus, setAutoSaveStatus] = React.useState<string>('');
  const [recentResumes, setRecentResumes] = React.useState<ResumeItem[]>([]);
  const [copyStatus, setCopyStatus] = React.useState<{ [key: string]: string }>(
    {}
  );
  const [deleteStatus, setDeleteStatus] = React.useState<{
    [key: string]: string;
  }>({});
  const [pendingDeleteIds, setPendingDeleteIds] = React.useState<{
    [key: string]: number;
  }>({});

  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        const data = await browser.storage.local.get('openAISettings');
        const loadedSettings = parseOpenAISettings(data.openAISettings);
        if (loadedSettings) {
          setSettings(loadedSettings);
        }
      } catch (error) {
        console.error('Error loading OpenAI settings:', error);
      }
    };

    const loadData = async () => {
      await loadSettings();
      await loadProfile();
      await loadRecentResumes();
      setLoading(false);
    };

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadProfile = async () => {
    try {
      const data = await browser.storage.local.get('userProfile');
      if (data.userProfile) {
        setProfile(JSON.parse(data.userProfile));
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    }
  };

  // Load recently generated resumes from storage
  const loadRecentResumes = async () => {
    try {
      const data = await browser.storage.local.get('recentlyResumeList');
      if (data.recentlyResumeList) {
        const validatedResumes = data.recentlyResumeList.map(resume => {
          if (!resume.date) {
            console.warn(
              'Resume missing date, adding current date:',
              resume.id
            );
            return { ...resume, date: new Date().toISOString() };
          }
          return resume;
        });

        setRecentResumes(validatedResumes);
      }
    } catch (error) {
      console.error('Error loading recent resumes:', error);
    }
  };

  // Copy resume content to clipboard
  const copyResumeToClipboard = async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyStatus({ ...copyStatus, [id]: 'Copied!' });
      setTimeout(() => {
        setCopyStatus(prev => {
          const newStatus = { ...prev };
          delete newStatus[id];
          return newStatus;
        });
      }, 2000);
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      setCopyStatus({ ...copyStatus, [id]: 'Failed to copy' });
      setTimeout(() => {
        setCopyStatus(prev => {
          const newStatus = { ...prev };
          delete newStatus[id];
          return newStatus;
        });
      }, 2000);
    }
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const formatted =
        date.toLocaleDateString() +
        ' ' +
        date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return formatted;
    } catch (e) {
      console.error('Error formatting date:', e);
      return dateString || 'No date available';
    }
  };

  // Save OpenAI settings to storage
  const saveSettings = async () => {
    try {
      // Use utility function to stringify settings
      const settingsJson = stringifyOpenAISettings(settings);
      await browser.storage.local.set({
        openAISettings: settingsJson,
      });
      setSaveStatus('Settings saved successfully!');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveStatus('Error saving settings');
    }
  };
  // No auto-save functionality - only update the state
  const updateSettingsState = React.useCallback(
    (updatedSettings: OpenAISettings) => {
      // Just update the state, don't save to storage
      setSettings(updatedSettings);
    },
    []
  );

  // Handle settings field changes - only update state, don't save
  const handleSettingChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    // Update settings directly
    const updatedSettings = {
      ...settings,
      [name]: value,
    };
    // Only update state, don't save to storage
    setSettings(updatedSettings);
  };
  // Only print simple values to avoid circular references
  console.log('Settings updated:', {
    endpoint: settings.endpoint,
    model: settings.model,
    apiKeyLength: settings.apiKey ? settings.apiKey.length : 0,
  });

  // Direct delete function without complex confirmation dialog
  const deleteResumeDirectly = async (id: string) => {
    try {
      if (!id) {
        console.error('Cannot delete: Invalid resume ID');
        return;
      }

      console.log('Starting deletion for resume ID:', id);

      // Get current resume list
      const data = await browser.storage.local.get('recentlyResumeList');
      console.log(
        'Got resume list from storage',
        data?.recentlyResumeList?.length || 'none'
      );

      if (!data.recentlyResumeList || !Array.isArray(data.recentlyResumeList)) {
        console.error('No valid resume list found in storage');
        return;
      }

      // Check if resume exists
      const resumeExists = data.recentlyResumeList.some(r => r.id === id);
      if (!resumeExists) {
        console.error('Resume not found with ID:', id);
        return;
      }

      // Filter out the resume to delete
      const updatedList = data.recentlyResumeList.filter(
        resume => resume.id !== id
      );
      console.log('Filtered resume list, new length:', updatedList.length);

      // Save updated list to storage
      await browser.storage.local.set({ recentlyResumeList: updatedList });
      console.log('Saved updated resume list to storage');

      // Update UI state
      setRecentResumes(updatedList);

      // Show success message
      setDeleteStatus({ ...deleteStatus, [id]: 'Deleted!' });
      setTimeout(() => {
        setDeleteStatus(prev => {
          const newStatus = { ...prev };
          delete newStatus[id];
          return newStatus;
        });
      }, 2000);

      console.log('Resume deleted successfully');
    } catch (error) {
      console.error('Error in deleteResumeDirectly:', error);
    }
  };

  // Two-step delete functionality - first click to confirm, second to execute
  const handleDeleteClick = (id: string) => {
    // If already waiting for confirmation, execute the actual deletion
    if (pendingDeleteIds[id]) {
      deleteResumeDirectly(id);

      // Clear confirmation state
      const newPendingIds = { ...pendingDeleteIds };
      delete newPendingIds[id];
      setPendingDeleteIds(newPendingIds);
    } else {
      // First click, set confirmation state
      const timestamp = Date.now();
      setPendingDeleteIds({
        ...pendingDeleteIds,
        [id]: timestamp,
      });

      // Auto-clear confirmation state after 5 seconds
      setTimeout(() => {
        setPendingDeleteIds(prev => {
          const newPendingIds = { ...prev };
          if (newPendingIds[id] === timestamp) {
            delete newPendingIds[id];
          }
          return newPendingIds;
        });
      }, 5000);
    }
  };

  // Get button display text
  const getButtonText = (id: string) => {
    if (deleteStatus[id]) {
      return deleteStatus[id];
    }
    if (pendingDeleteIds[id]) {
      return 'Confirm';
    }
    return 'Delete';
  };

  // Get button class name
  const getButtonClassName = (id: string) => {
    const baseClass = 'text-xs px-2 py-0.5 rounded';

    if (deleteStatus[id]) {
      return `${baseClass} bg-green-100 text-green-800`;
    }

    if (pendingDeleteIds[id]) {
      return `${baseClass} bg-yellow-500 text-white hover:bg-yellow-600`;
    }

    return `${baseClass} bg-red-100 text-red-800 hover:bg-red-200`;
  };

  // Get button title
  const getButtonTitle = (id: string) => {
    return pendingDeleteIds[id]
      ? 'Click again to confirm deletion'
      : 'Delete this resume';
  };

  // Helper function to render skill badges
  const renderSkillBadges = (skills: ResumeItem['metadata']['keySkills']) => {
    if (!skills) return null;

    // Get all skills in a flat array for display
    const allSkills: string[] = [];

    // Add technical skills
    if (skills.technical) {
      Object.values(skills.technical).forEach(categorySkills => {
        allSkills.push(...categorySkills.slice(0, 2)); // Limit to 2 skills per category
      });
    }

    // Add other skill types
    if (skills.soft) allSkills.push(...skills.soft.slice(0, 1));
    if (skills.domain) allSkills.push(...skills.domain.slice(0, 1));
    if (skills.tools) allSkills.push(...skills.tools.slice(0, 1));
    if (skills.uncategorized)
      allSkills.push(...skills.uncategorized.slice(0, 1));

    // Limit to only showing 3 skills
    const displaySkills = allSkills.slice(0, 3);
    const remainingCount = Math.max(
      0,
      (skills.technical ? Object.values(skills.technical).flat().length : 0) +
        (skills.soft?.length || 0) +
        (skills.domain?.length || 0) +
        (skills.tools?.length || 0) +
        (skills.uncategorized?.length || 0) -
        displaySkills.length
    );

    return (
      <>
        {displaySkills.map(skill => (
          <Badge
            key={`skill-${skill}`}
            variant="secondary"
            className="text-xs bg-amber-50 text-amber-800 hover:bg-amber-100 px-2 py-0.5"
          >
            {skill}
          </Badge>
        ))}
        {remainingCount > 0 && (
          <Badge
            variant="secondary"
            className="text-xs bg-gray-100 text-gray-800 hover:bg-gray-200 px-2 py-0.5"
          >
            +{remainingCount}
          </Badge>
        )}
      </>
    );
  };

  return (
    <div className="w-96 p-4 font-sans popup-container">
      <h1 className="text-xl font-bold mb-4 text-center text-gray-800 flex items-center justify-center">
        CoForce Apply
        <Logo size="6" className="ml-2" />
      </h1>

      {saveStatus && (
        <div className="bg-secondary-500 text-white p-2 mb-4 rounded text-center text-sm">
          {saveStatus}
        </div>
      )}

      {autoSaveStatus && (
        <div className="bg-secondary-500 text-white p-2 rounded text-center text-sm fixed bottom-4 right-4 z-50 shadow-md">
          {autoSaveStatus}
        </div>
      )}

      <button
        type="button"
        onClick={async () => {
          try {
            // Get current active tab
            const tabs = await browser.tabs.query({
              active: true,
              currentWindow: true,
            });
            const currentTab = tabs[0];

            if (!currentTab || !currentTab.id) {
              throw new Error('No active tab found');
            }

            // First check if content script is accessible by sending a ping message
            try {
              // Use a simple ping message to check content script availability
              await browser.tabs.sendMessage(currentTab.id, { action: 'ping' });
            } catch (connectionError) {
              // Content script not accessible, try to inject it
              console.error(
                'Cannot access content script, may need to refresh the page:',
                connectionError
              );

              // Show notification to user
              await browser.notifications.create({
                type: 'basic',
                iconUrl: browser.runtime.getURL(
                  'assets/icons/android-chrome-192x192.png'
                ),
                title: 'CoForce Apply',
                message:
                  'Please refresh the page and try again, or navigate to a job description page.',
              });

              return; // Stop execution
            }

            // Show loading notification
            const loadingToastId = `generate-resume-${Date.now()}`;
            await browser.tabs.sendMessage(currentTab.id, {
              action: 'showLoadingToast',
              id: loadingToastId,
              message: 'Preparing to generate resume...',
            });

            // Get page info from content script
            const response = await browser.tabs.sendMessage(currentTab.id, {
              action: 'getCurrentPageInfo',
            });

            if (!response || !response.success) {
              // Hide loading toast
              await browser.tabs.sendMessage(currentTab.id, {
                action: 'hideLoadingToast',
                id: loadingToastId,
              });

              throw new Error(
                response?.error || 'Failed to get page information'
              );
            }

            // Check if content is empty or too short
            if (!response.content || response.content.length < 50) {
              // Hide loading toast
              await browser.tabs.sendMessage(currentTab.id, {
                action: 'hideLoadingToast',
                id: loadingToastId,
              });

              // Show notification
              await browser.tabs.sendMessage(currentTab.id, {
                action: 'showNotification',
                message:
                  'Page content is too short. Please navigate to a job description page.',
                type: 'error',
              });

              return;
            }

            // Update loading notification
            await browser.tabs.sendMessage(currentTab.id, {
              action: 'updateLoadingToast',
              id: loadingToastId,
              message: 'Generating resume from current page...',
            });

            // Call background script to handle AIsimple workflow
            const result = await browser.runtime.sendMessage({
              action: 'generateResumeFromPage',
              pageInfo: {
                url: response.url,
                title: response.title,
                content: response.content,
              },
            });

            // Hide loading notification
            await browser.tabs.sendMessage(currentTab.id, {
              action: 'hideLoadingToast',
              id: loadingToastId,
            });

            if (!result || !result.success) {
              throw new Error(result?.error || 'Failed to generate resume');
            }

            // Show success notification
            await browser.tabs.sendMessage(currentTab.id, {
              action: 'showNotification',
              message: 'Resume generated successfully!',
              type: 'success',
            });

            // Reload recent resumes
            await loadRecentResumes();
          } catch (error) {
            console.error('Error generating resume from current page:', error);
            // Try to show error notification
            try {
              const tabs = await browser.tabs.query({
                active: true,
                currentWindow: true,
              });
              const currentTab = tabs[0];
              if (currentTab && currentTab.id) {
                try {
                  // Try to send message to content script
                  await browser.tabs.sendMessage(currentTab.id, {
                    action: 'showNotification',
                    message: `Error: ${error.message || 'Failed to generate resume'}`,
                    type: 'error',
                  });
                } catch (contentScriptError) {
                  // If content script is not accessible, use browser notification
                  await browser.notifications.create({
                    type: 'basic',
                    iconUrl: browser.runtime.getURL(
                      'assets/icons/android-chrome-192x192.png'
                    ),
                    title: 'CoForce Apply - Error',
                    message: `Error: ${error.message || 'Failed to generate resume'}`,
                  });
                }
              }
            } catch (notificationError) {
              console.error('Error showing notification:', notificationError);
            }
          }
        }}
        className="w-full mb-4 bg-gradient-to-r from-primary-600 to-secondary-600 hover:from-primary-700 hover:to-secondary-700 text-white font-medium py-3 px-4 rounded-md text-sm shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 flex items-center justify-center transition-all"
      >
        <FileText className="size-5 mr-2" />
        Generate Resume from Current Page
      </button>

      <div className="border border-gray-200 rounded overflow-hidden mb-4">
        <Tabs.Root defaultValue="resumes" className="w-full">
          <Tabs.List className="flex bg-gray-100 border-b border-gray-200">
            <Tabs.Trigger
              value="resumes"
              className="px-3 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-primary-700 data-[state=active]:border-b-2 data-[state=active]:border-primary-500 data-[state=inactive]:text-gray-600 data-[state=inactive]:hover:bg-gray-200"
            >
              Recent Resumes
            </Tabs.Trigger>
            <Tabs.Trigger
              value="apply"
              className="px-3 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-primary-700 data-[state=active]:border-b-2 data-[state=active]:border-primary-500 data-[state=inactive]:text-gray-600 data-[state=inactive]:hover:bg-gray-200"
            >
              Apply
            </Tabs.Trigger>
            <Tabs.Trigger
              value="profile"
              className="px-3 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-primary-700 data-[state=active]:border-b-2 data-[state=active]:border-primary-500 data-[state=inactive]:text-gray-600 data-[state=inactive]:hover:bg-gray-200"
            >
              Profile
            </Tabs.Trigger>
            <Tabs.Trigger
              value="settings"
              className="px-3 py-2 text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-primary-700 data-[state=active]:border-b-2 data-[state=active]:border-primary-500 data-[state=inactive]:text-gray-600 data-[state=inactive]:hover:bg-gray-200"
            >
              Settings
            </Tabs.Trigger>
          </Tabs.List>

          <div className="bg-white">
            {/* Apply Tab */}
            <Tabs.Content value="apply" className="p-4">
              <ApplyTab />
            </Tabs.Content>

            {/* Settings Tab */}
            <Tabs.Content value="settings" className="p-4">
              <InputField
                label="OpenAI Endpoint"
                type="text"
                id="endpoint"
                name="endpoint"
                value={settings.endpoint}
                onChange={handleSettingChange}
                placeholder="https://api.openai.com/v1"
                className="mb-3"
              />

              <InputField
                label="API Key"
                type="password"
                id="apiKey"
                name="apiKey"
                value={settings.apiKey}
                onChange={handleSettingChange}
                placeholder="sk-..."
                className="mb-3"
              />

              <InputField
                label="Model"
                type="text"
                id="model"
                name="model"
                value={settings.model}
                onChange={handleSettingChange}
                placeholder="e.g., gpt-3.5-turbo, gpt-4, claude-3-opus-20240229"
                className="mb-3"
              />

              <button
                type="button"
                onClick={saveSettings}
                className="w-full bg-primary-500 hover:bg-primary-600 text-primary-foreground font-medium py-2 px-4 rounded text-sm focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:ring-offset-2"
              >
                Save Settings
              </button>

              <div className="mt-4 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => openWebPage('options.html')}
                  className="w-full flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-2 px-4 rounded text-sm focus:outline-none"
                >
                  <Settings className="size-4" />
                  Go to Advanced Settings
                </button>
              </div>
            </Tabs.Content>

            {/* Profile Tab */}
            <Tabs.Content value="profile" className="p-4">
              {loading && <div className="text-center py-4">Loading...</div>}

              {!loading && !profile && (
                <div className="text-center py-4">
                  <p className="mb-3 text-gray-600">
                    No profile found. Please set up your profile.
                  </p>
                  <button
                    type="button"
                    onClick={() => openWebPage('options.html')}
                    className="bg-primary-500 hover:bg-primary-600 text-primary-foreground font-medium py-2 px-4 rounded text-sm focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:ring-offset-2"
                  >
                    Set Up Profile
                  </button>
                </div>
              )}

              {!loading && profile && (
                <div className="space-y-3">
                  <div className="border-b pb-2">
                    <h3 className="font-bold text-lg">{profile.name}</h3>
                    <p className="text-gray-600">{profile.title}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="font-medium">Email:</span>{' '}
                      {profile.email}
                    </div>
                    <div>
                      <span className="font-medium">Phone:</span>{' '}
                      {profile.phone}
                    </div>
                    <div>
                      <span className="font-medium">Location:</span>{' '}
                      {profile.location}
                    </div>
                  </div>

                  <div className="pt-2">
                    <h4 className="font-medium text-sm mb-1">Skills</h4>
                    <div className="flex flex-wrap gap-1">
                      {profile.skills.map(skill => (
                        <span
                          key={`skill-${skill}`}
                          className="bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => openWebPage('options.html')}
                      className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-2 px-4 rounded text-sm focus:outline-none"
                    >
                      Edit Profile
                    </button>
                  </div>
                </div>
              )}
            </Tabs.Content>
          </div>

          {/* Recent Resumes Tab */}
          <Tabs.Content value="resumes" className="p-4">
            {loading && <div className="text-center py-4">Loading...</div>}

            {!loading && recentResumes.length === 0 && (
              <div className="text-center py-4">
                <p className="mb-3 text-gray-600">
                  No resumes generated yet. Use the context menu on job
                  descriptions to generate resumes.
                </p>
              </div>
            )}

            {!loading && recentResumes.length > 0 && (
              <div className="space-y-4">
                <h3 className="font-medium text-sm mb-3">
                  Recently Generated Resumes
                </h3>

                <div className="max-h-[380px] overflow-y-auto scrollbar-invisible scrollable-content pr-1">
                  {recentResumes.map(resume => (
                    <Card
                      key={resume.id}
                      className="p-3 pb-4 shadow-sm hover:shadow-md transition-shadow mb-3 relative"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex items-center">
                          <Badge variant="outline" className="text-xs">
                            {formatDate(resume.date)}
                          </Badge>
                        </div>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              copyResumeToClipboard(resume.content, resume.id)
                            }
                            className={`text-xs px-2 py-0.5 rounded ${
                              copyStatus[resume.id]
                                ? 'bg-green-100 text-green-800'
                                : 'bg-primary-100 text-primary-800 hover:bg-primary-200'
                            }`}
                          >
                            {copyStatus[resume.id] || 'Copy'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openInOverleaf(
                                resume.content,
                                `resume_${new Date().getTime()}.tex`
                              )
                            }
                            className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800 hover:bg-green-200"
                            title="Open in Overleaf"
                          >
                            Overleaf
                          </button>
                        </div>
                      </div>

                      {resume.metadata && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          <Badge
                            variant="secondary"
                            className="text-xs bg-blue-100 text-blue-800 hover:bg-blue-200 px-2 py-0.5"
                          >
                            {resume.metadata.company}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className="text-xs bg-purple-100 text-purple-800 hover:bg-purple-200 px-2 py-0.5"
                          >
                            {resume.metadata.position}
                          </Badge>
                          {resume.metadata.industry && (
                            <Badge
                              variant="secondary"
                              className="text-xs bg-green-100 text-green-800 hover:bg-green-200 px-2 py-0.5"
                            >
                              {resume.metadata.industry}
                            </Badge>
                          )}
                          {renderSkillBadges(resume.metadata.keySkills)}
                        </div>
                      )}

                      <div className="text-xs line-clamp-2 text-gray-700 mb-7">
                        <span className="font-medium">Brief Description:</span>{' '}
                        {resume.jobDescription}
                      </div>

                      <div className="absolute bottom-1 right-3 mb-1">
                        <button
                          type="button"
                          onClick={() => handleDeleteClick(resume.id)}
                          className={getButtonClassName(resume.id)}
                          title={getButtonTitle(resume.id)}
                        >
                          {getButtonText(resume.id)}
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </Tabs.Content>
        </Tabs.Root>
      </div>

      <div className="text-center text-xs text-gray-500 flex max-w-full justify-between align-middle items-center">
        <p>CoForce Apply v1.0.0</p>
        <p className="mt-1">
          <a
            href="#"
            onClick={e => {
              e.preventDefault();
              openWebPage('options.html');
            }}
            className="text-primary-600 hover:text-primary-800"
          >
            Advanced Settings
          </a>
        </p>
      </div>
    </div>
  );
};

export default Popup;
