# Hover-Link-Preview-Extensiom
Build a modern Chrome Extension (Manifest V3) that displays a metadata preview card when a user hovers over any hyperlink on a webpage.

When the user hovers over an <a> tag for approximately 500ms:

Extract the URL from the link.
Fetch the target webpage in the background.
Parse the HTML and extract:
Page title (<title>)
Meta description (meta[name="description"])
Open Graph title (og:title)
Open Graph description (og:description)
Open Graph image (og:image)
Favicon
Domain name
Display a floating preview card near the cursor.
