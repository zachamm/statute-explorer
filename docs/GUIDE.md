# Using Statute Anatomy Explorer

This app lets you read a law as a navigable structure instead of one long
wall of text. Click through its sections, jump between sections that
reference each other, and see what a legal term means without losing your
place.

## Reading a statute

- **Left sidebar**: the table of contents. Click any section to read it.
  Click a Part heading to collapse or expand that section of the list.
- **Middle panel**: the section you're reading. Two kinds of text are
  clickable:
  - Text with a **blue underline** is a reference to another section (e.g.
    "as required by section 14"). Click it to jump straight there.
  - Text with an **orange dashed underline** is a defined term. Hover over
    it for a quick preview of what it means, or click it to jump to the
    section that defines it.
- **Right panel**: a small diagram of which sections cite the one you're
  reading and which sections it cites, plus a full alphabetical list of
  every defined term in the statute.
- **Top of the page**: use the dropdown to switch between the different
  laws that are loaded.

## Adding a new statute

Click **"Add a statute"** at the top of the page. There are two ways to add
one.

### Paste a link

Copy the statute's web address from its official government page and paste
it in. Two sources work right now:

| Source | Example |
|---|---|
| Any federal law, from laws-lois.justice.gc.ca | `https://laws-lois.justice.gc.ca/eng/acts/C-46/` (Criminal Code) |
| Any Ontario law, from ontario.ca/laws | `https://www.ontario.ca/laws/statute/90h08` (Highway Traffic Act) |

You don't need to edit the link. Copy it straight from your browser's
address bar while you're looking at the statute's page on one of those two
sites, and paste it in as-is.

### Upload a file

If you already have a downloaded copy of the statute (an XML file from
Justice Laws, or a JSON file exported from Ontario's e-Laws site), drag it
onto the upload box, or click the box to browse for it.

### If it doesn't work

You'll see a clear error message explaining what went wrong. The most
common cause is pasting a link from somewhere other than the two sites
above, or from a page that isn't a specific statute (like a search-results
page). Go back to the statute's own page on the government site and copy
the link from there.

### Where imported statutes go

A statute you add through this tab is saved in your own browser, not
uploaded anywhere shared. Reload the page and it's still there; open the
app in a different browser and it won't be. If you want it available to
everyone, that's a different (CLI-based) process; see the project README.

## Where the data comes from

Everything you see is the government's own published legal text, parsed the
same consistent way every time. Nothing is summarized, rewritten, or
AI-generated. The cross-reference and defined-term links come from
pattern-matching standard legal drafting language ("section 14", "subsection
3 (2)") in the source text itself. No AI involved.
