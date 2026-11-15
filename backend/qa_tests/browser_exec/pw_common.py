from playwright.sync_api import sync_playwright
BASE = "http://127.0.0.1:5173"
ARGS = ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"]
def launch(p, fake_cam=True):
    args = list(ARGS)
    if not fake_cam:
        args = [a for a in args if "media-stream" not in a]
    return p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=args)
