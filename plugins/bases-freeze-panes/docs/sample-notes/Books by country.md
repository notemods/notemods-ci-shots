Where the books on the shelves come from, as a base code block inside this note.

```base
filters:
  and:
    - file.inFolder("Bases Freeze Panes/Books")
views:
  - type: table
    name: By country
    order:
      - file.name
      - country
      - language
      - author
      - year
      - type
      - genre
      - pages
      - status
      - rating
      - format
      - publisher
      - shelf
```
