import { browser, Notifications, Runtime } from 'webextension-polyfill-ts';
import { generateTailoredResumeSimple } from '@/utils/aiSimpleWorkflow';
import {
  getOpenAISettings,
  getResumeTemplate,
  getUserProfile,
} from '@/utils/config';

const CONTEXT_MENU_ID = 'GENERATE_RESUME_SNIPPET';
let isWorkflowRunning = false;

// Function to create the context menu
async function createContextMenu() {
  try {
    // First remove any existing context menus to avoid duplicates
    await browser.contextMenus.removeAll();
    console.info('Removed existing context menus');

    // Create context menu item for resume generation
    browser.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Generate Resume for Job Description',
      contexts: ['selection'], // Only show when text is selected
    });

    console.info('Context menu created successfully.');
  } catch (error) {
    console.error('Error creating context menu: ' + String(error));
  }
}

// Create context menu when extension is installed
browser.runtime.onInstalled.addListener((): void => {
  console.info('Extension installed');
  createContextMenu();
});

// Also create the context menu when the service worker starts
createContextMenu();

// Helper function to send messages to content script
async function sendTabMessage(tabId: number, message: any): Promise<any> {
  try {
    return await browser.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.error('Error sending message to tab: ' + String(error));
    throw error;
  }
}

// Function to create and show a notification
async function showNotification(
  options: Notifications.CreateNotificationOptions
): Promise<string> {
  try {
    return await browser.notifications.create(options);
  } catch (error) {
    console.error('Notification error: ' + String(error));
    throw error;
  }
}

// Listener for context menu clicks
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  console.info('Context menu clicked with ID: ' + info.menuItemId);

  // Exit early if workflow is already running or if menu item doesn't match
  if (
    isWorkflowRunning ||
    info.menuItemId !== CONTEXT_MENU_ID ||
    !info.selectionText ||
    !tab?.id
  ) {
    console.info(
      isWorkflowRunning
        ? 'Ignoring click - workflow already running'
        : 'Ignoring click - conditions not met'
    );
    return;
  }

  // Set the flag to prevent multiple workflows
  isWorkflowRunning = true;

  // Keep track of the loading notification ID
  const loadingNotificationId = 'resume-generator-loading';

  try {
    // Show loading notification in the content script
    await sendTabMessage(tab.id, {
      action: 'showLoadingToast',
      id: loadingNotificationId,
      message: 'Generating resume...',
    });

    // Get user profile and other necessary data
    const userProfile = await getUserProfile();
    if (!userProfile) {
      throw new Error(
        'User profile not found. Please set up your profile first.'
      );
    }

    const template = await getResumeTemplate();
    if (!template) {
      throw new Error(
        'Resume template not found. Please set up a template first.'
      );
    }

    const settings = await getOpenAISettings();
    if (!settings.apiKey) {
      throw new Error(
        'OpenAI API key not found. Please set up your API key first.'
      );
    }

    // Get page details
    let pageUrl = '';
    let pageTitle = '';

    if (tab) {
      pageUrl = tab.url || '';
      pageTitle = tab.title || '';
    }

    console.info('pageUrl', pageUrl);
    console.info('pageTitle', pageTitle);

    // Update progress notification
    await sendTabMessage(tab.id, {
      action: 'updateLoadingToast',
      id: loadingNotificationId,
      message: 'Creating tailored resume...',
    });

    // Generate resume with page details
    const result = await generateTailoredResumeSimple(
      info.selectionText,
      userProfile,
      template,
      settings,
      pageUrl,
      pageTitle
    );

    // Hide loading notification
    await sendTabMessage(tab.id, {
      action: 'hideLoadingToast',
      id: loadingNotificationId,
    });

    if (result && result.content) {
      // Save the resume to storage for later access
      try {
        // Get existing resume list
        const storageData =
          await browser.storage.local.get('recentlyResumeList');
        const recentlyResumeList = storageData.recentlyResumeList || [];

        // Add new resume to the list (limit to 10 items)
        const newResume = {
          id: Date.now().toString(),
          date: new Date().toISOString(),
          content: result.content,
          preview: result.content.substring(0, 100) + '...',
          jobDescription: info.selectionText.substring(0, 100) + '...',
          pageUrl,
          pageTitle,
          metadata: result.metadata,
        };

        // Add to beginning of array and limit to 10 items
        recentlyResumeList.unshift(newResume);
        if (recentlyResumeList.length > 10) {
          recentlyResumeList.pop();
        }

        // Save back to storage
        await browser.storage.local.set({ recentlyResumeList });

        // Show success notification
        await showNotification({
          type: 'basic',
          iconUrl: browser.runtime.getURL(
            'assets/icons/android-chrome-192x192.png'
          ),
          title: 'CoForce Apply',
          message: 'Resume generated and saved!',
        });
      } catch (storageError) {
        console.error(
          'Error saving resume to storage: ' + String(storageError)
        );
      }
    } else {
      // Show error notification if no result but no exception
      await showNotification({
        type: 'basic',
        iconUrl: browser.runtime.getURL(
          'assets/icons/android-chrome-192x192.png'
        ),
        title: 'CoForce Apply - Error',
        message: 'Failed to generate resume. Please try again.',
      });
    }
  } catch (error) {
    // Make sure to hide the loading toast if there's an uncaught error
    try {
      await sendTabMessage(tab.id, {
        action: 'hideLoadingToast',
        id: loadingNotificationId,
      });
    } catch (toastError) {
      console.error(
        'Error hiding loading toast after error: ' + String(toastError)
      );
    }

    // Show error notification
    try {
      await showNotification({
        type: 'basic',
        iconUrl: browser.runtime.getURL(
          'assets/icons/android-chrome-192x192.png'
        ),
        title: 'CoForce Apply - Error',
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } catch (notificationError) {
      console.error(
        'Failed to show error notification: ' + String(notificationError)
      );
    }
  } finally {
    // Always reset the workflow flag when done
    isWorkflowRunning = false;
  }
});

// Message listener
browser.runtime.onMessage.addListener(
  (message: unknown, sender: Runtime.MessageSender) => {
    if (message && typeof message === 'object' && 'action' in message) {
      if (message.action === 'contentScriptReady') {
        console.debug('Content script ready notification received');
        return Promise.resolve({ success: true });
      }

      // Handle generateResumeFromPage action
      if (
        message.action === 'generateResumeFromPage' &&
        'pageInfo' in message
      ) {
        console.debug('Generating resume from current page');

        // Make sure the workflow is not already running
        if (isWorkflowRunning) {
          return Promise.resolve({
            success: false,
            error: 'Resume generation workflow is already running',
          });
        }

        // Set the flag to prevent multiple workflows
        isWorkflowRunning = true;

        // Create promise to handle the async process
        return (async () => {
          try {
            const pageInfo = message.pageInfo as {
              url: string;
              title: string;
              content: string;
            };

            // Validate inputs
            if (!pageInfo || typeof pageInfo !== 'object') {
              throw new Error('Invalid page info object');
            }

            // Validate content
            if (
              !pageInfo.content ||
              typeof pageInfo.content !== 'string' ||
              pageInfo.content.length < 50
            ) {
              throw new Error('Page content is too short or invalid');
            }

            console.info('Processing page: ' + (pageInfo.title || 'Untitled'));
            console.info(
              'Content length: ' + pageInfo.content.length + ' characters'
            );

            // Extract content from the page
            const jobDescription = pageInfo.content || '';

            // Get user profile and other necessary data
            const userProfile = await getUserProfile();
            if (!userProfile) {
              throw new Error(
                'User profile not found. Please set up your profile first.'
              );
            }
            console.info('User profile loaded successfully');

            const template = await getResumeTemplate();
            if (!template) {
              throw new Error(
                'Resume template not found. Please set up a template first.'
              );
            }
            console.info('Resume template loaded successfully');

            const settings = await getOpenAISettings();
            if (!settings.apiKey) {
              throw new Error(
                'OpenAI API key not found. Please set up your API key first.'
              );
            }
            console.info('OpenAI settings loaded successfully');

            // Generate resume with page details
            console.info('Starting AI resume generation...');
            const result = await generateTailoredResumeSimple(
              jobDescription,
              userProfile,
              template,
              settings,
              pageInfo.url,
              pageInfo.title
            );

            if (!result) {
              throw new Error('Resume generation returned no result');
            }

            if (!result.content) {
              throw new Error('Resume generation returned empty content');
            }

            console.info(
              'Resume generated successfully, content length: ' +
                result.content.length
            );

            // Save the resume to storage for later access
            try {
              // Get existing resume list
              const storageData =
                await browser.storage.local.get('recentlyResumeList');
              const recentlyResumeList = storageData.recentlyResumeList || [];
              console.info(
                'Loaded existing resumes: ' + recentlyResumeList.length
              );

              // Add new resume to the list (limit to 10 items)
              const newResume = {
                id: Date.now().toString(),
                date: new Date().toISOString(),
                content: result.content,
                preview: result.content.substring(0, 100) + '...',
                jobDescription: jobDescription.substring(0, 100) + '...',
                pageUrl: pageInfo.url,
                pageTitle: pageInfo.title,
                metadata: result.metadata,
              };

              // Add to beginning of array and limit to 10 items
              recentlyResumeList.unshift(newResume);
              if (recentlyResumeList.length > 10) {
                recentlyResumeList.pop();
              }

              // Save back to storage
              await browser.storage.local.set({ recentlyResumeList });

              // Show success notification
              await showNotification({
                type: 'basic',
                iconUrl: browser.runtime.getURL(
                  'assets/icons/android-chrome-192x192.png'
                ),
                title: 'CoForce Apply',
                message: 'Resume generated and saved!',
              });

              return { success: true };
            } catch (storageError) {
              console.error(
                'Error saving resume to storage: ' + String(storageError)
              );
              throw storageError;
            }
          } catch (error) {
            console.error(
              'Error generating resume from page: ' + String(error)
            );

            // Show error notification
            try {
              await showNotification({
                type: 'basic',
                iconUrl: browser.runtime.getURL(
                  'assets/icons/android-chrome-192x192.png'
                ),
                title: 'CoForce Apply - Error',
                message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              });
            } catch (notificationError) {
              console.error(
                'Failed to show error notification: ' +
                  String(notificationError)
              );
            }

            return {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            };
          } finally {
            // Always reset the workflow flag when done
            isWorkflowRunning = false;
          }
        })();
      }
    }

    // Default response
    return Promise.resolve({ success: false });
  }
);
