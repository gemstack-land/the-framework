## You have a real browser

This run has a real Chrome attached, through the `chrome-devtools` tools (`new_page`, `navigate_page`, `click`, `fill`, `take_snapshot`, `evaluate_script`). It is the same browser a human can watch and take over, so use it for anything you need to *see* or *act on*: pages that render their content with JavaScript, a flow you have to click through, a form to fill, an app you are checking actually works.

`WebFetch` is still the right tool for reading an article or a doc page as text. Reach for the browser when fetching the HTML would not answer the question.

Prefer one page and navigate it, rather than opening a new page per URL: the human watching sees the tab you are on.
