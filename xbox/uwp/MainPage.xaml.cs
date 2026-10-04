using System;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;

// Throne of Shadows — UWP shell code-behind.
// Loads the live game URL in a full-screen WebView2 (WinUI 2).
// Do NOT "upgrade" this project to WinUI 3 / Windows App SDK: that stack is
// desktop-only and will not install on an Xbox. UWP + WinUI 2 is the path
// that runs on console.
namespace ThroneOfShadows
{
    public sealed partial class MainPage : Page
    {
        private const string GameUrl = "https://throne-of-shadows.onrender.com/";

        public MainPage()
        {
            this.InitializeComponent();
            this.Loaded += MainPage_Loaded;
        }

        private async void MainPage_Loaded(object sender, RoutedEventArgs e)
        {
            try
            {
                // Requires the WebView2 Runtime on the console (see BUILD.md).
                await GameView.EnsureCoreWebView2Async();
                GameView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                GameView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                GameView.Source = new Uri(GameUrl);
            }
            catch (Exception ex)
            {
                // Most likely cause: WebView2 Runtime is not installed.
                ErrorText.Text = "Could not start the WebView2 engine.\n\n" +
                    "Install the WebView2 Runtime on this console, then relaunch.\n\n" +
                    "Details: " + ex.Message;
                ErrorText.Visibility = Visibility.Visible;
            }
        }
    }
}
