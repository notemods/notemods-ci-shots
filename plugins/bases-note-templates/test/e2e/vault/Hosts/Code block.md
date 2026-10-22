# Code block

```base
filters:
  and:
    - file.inFolder("Books")
    - status == "unread"
views:
  - type: table
    name: Code
    order:
      - file.name
      - author
```
