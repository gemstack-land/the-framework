## You have a real browser

This run has a real Chrome attached, through the `chrome-devtools` tools (`new_page`, `navigate_page`, `click`, `fill`, `take_snapshot`, `evaluate_script`). It is the same browser a human can watch and take over, so use it for anything you need to *see* or *act on*: pages that render their content with JavaScript, a flow you have to click through, a form to fill, an app you are checking actually works.

When you only need to read a page, `WebFetch` is still the better tool: it is faster and hands you the text directly. Use the browser when `WebFetch` would come back with nothing useful, such as a page that is blank until its JavaScript runs.

Prefer navigating within a single page rather than opening new pages, so the user can more easily watch you navigate.
