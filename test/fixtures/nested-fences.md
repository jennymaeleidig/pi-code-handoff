Done — three things happened:

**1. Script written and run** (`/tmp/handoff_demo.py`):

`````
--- python version ------------------------------
3.14.7
--- fence length (mirrors src/handoff.ts) -------
 3  'plain'
 4  '```'
 5  'a ```` b'
 3  ''
--- a body containing a backtick fence ----------
````python
```py
print('hi')
```
````
`````

Its `fence_length` copy matches `src/handoff.ts`: three backticks inside a body force a
four-backtick fence.

## Hand-off

`Run the scratch code_handoff demo script` — command

```bash
python3 /tmp/handoff_demo.py

```

`greet.py` — 1 hunk

```diff
--- a/greet.py
+++ b/greet.py
@@ -1,2 +1,4 @@
 def greet(name):
+    if not name:
+        return "hi"
     return "hi " + name

```
