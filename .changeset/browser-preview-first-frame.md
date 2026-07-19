---
'@gemstack/framework': patch
---

Paint the browser preview's first frame. Chrome does not finalize a `multipart/x-mixed-replace` part until the next boundary arrives, so a page that was not repainting left the pane blank while the bridge held a good JPEG. The newest frame now repeats while a viewer is attached, which is the case the preview exists for: a run parked on a login wall is not changing on its own.
