# Using Statute Map

Read a law as a navigable structure instead of one long wall of text, and see
how its sections connect.

## Finding a statute

The **Library** searches every federal Act and regulation, plus the main Ontario
Acts. Type a name ("Criminal Code"), a short form ("CDSA", "YCJA"), or a code
("C-46"). Press Enter to open the top result, or use a result's **Read** and
**Map** buttons.

From any other view, press **/** to jump to the search box at the top of the page.

Ontario Act not listed? Paste its link from ontario.ca/laws into the Library's
search box. Links from laws-lois.justice.gc.ca work there too.

## Where the text comes from

The app doesn't store any law. Opening a statute downloads it from Justice Laws
or Ontario e-Laws at that moment, so the first open takes a few seconds and needs
a connection.

Your browser then keeps a private copy, so it reopens instantly and works
offline. That copy doesn't change on its own. If the official text has been amended
since, you'll see an **Update** button in the Library and on the map, and a notice when
you read it. These are checked about once a day. **Remove** in the Library deletes your
copy outright.

Nothing is summarized, rewritten or AI-generated. It's the government's published
text. The links come from pattern-matching standard legal drafting language
("section 14", "subsection 3 (2)") in that text.

## Reading a statute

- **Left**: the table of contents. Click a section to read it, or a Part heading
  to collapse it. **Search this statute** (Ctrl+K / Cmd+K) finds headings, section
  numbers and words in the text, with the best matches first.
- **Middle**: the section. Text with a **blue underline** is a reference to another
  section, so click it to go there. Text with an **orange dashed underline** is a
  defined term: hover for its meaning, or click to go to its definition.
- **Right**: a small diagram of what this section cites and what cites it, the same
  thing as lists, and an index of every defined term in the statute.

Under each section's heading:

- **Copy citation** copies a McGill-style citation, like *Criminal Code*, RSC 1985, c
  C-46, s 265, with the title in italics when you paste into a word processor. Check it
  against the guide you're using before relying on it.
- **Find cases** searches CanLII for decisions mentioning this section. It's a text
  search, so it can include some cases that mention the section only in passing.
- **Show on map** opens this section on the map.

The right side also lists the **regulations made under an Act**, or the Act a regulation
is made under. That list comes from Justice Laws, so it covers federal law only.

## Reading the map

Each circle is a section, and bigger means more cited. Each arrow is a citation
from one section to another. Hover over a type in the legend for what it means.

| Arrow | Means |
|---|---|
| Definitional (solid) | A term here is defined by the target section |
| Punishment (dashed) | The target sets the offence or penalty |
| Procedural (dotted) | "In accordance with", "subject to" or "pursuant to" the target |
| Repeal | The target is being repealed or substituted |
| Other | Cites the target in some other way |

A circle's color tells you which statute it belongs to. A **grey dashed circle is a
ghost**: something on the map cites it, but its text isn't on the map. Click one.
If its statute can be added, there's a button for that, and the ghost turns into the
real section. If its statute is already on the map, the section is probably repealed.

Click a section to see its text, what it cites and what cites it. **Read in full**
takes you to the same section in the reader, and **Find cases** searches CanLII for it.
**Follow its definitions** traces where
its meaning comes from, step by step.

In the sidebar, add more statutes to see how they connect, jump to a section by number
or heading, or look for circular definitions.

Drag to pan, scroll to zoom, drag a circle to move it. By keyboard, Tab reaches the
graph and the arrow keys follow citations: right and down go outward, left and up go
inward. Enter opens a section and Escape goes back to the search box.

## Projects

A project is a saved set of statutes on the map. Use them to keep different topics
apart. The **⋯** button beside the project's name has New, Rename, Export, Import and
Delete. **Export** saves a project with its statute text to a file, and **Import**
loads that file in another browser without downloading anything.

## Uploading a file

You shouldn't need to, but the bottom of the Library accepts a Justice Laws XML file
or an e-Laws JSON export. It's saved in your browser like anything else you open.
