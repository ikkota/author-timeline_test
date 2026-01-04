# Author Historical Timeline

A web-based interactive timeline of authors, visualizing their birth, death, or floruit dates.

## Deployment

This project is ready for **GitHub Pages**.

1.  Push this entire repository to GitHub.
2.  Go to **Settings** -> **Pages**.
3.  Under **Source**, select **Deploy from a branch**.
4.  Select **Branch**: `main` (or master).
5.  Select **Folder**: `/public`.
6.  Save.

Your timeline will be live at `https://<username>.github.io/<repo-name>/`.

## Data Update

To update the data:
1.  Edit `author_metadata_final.xlsx`.
2.  Run `python convert_to_json.py`.
3.  Commit and push the updated `public/data/authors.json`.
