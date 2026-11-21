# 0003 Uploaded documents are stored inside Databricks

Date: 2026-11-21. Status: accepted. Replaces an earlier decision to store links only.

Chat, contract reading and RFP comparison all need the text of contracts and vendor
responses, so the files have to be readable by the app. Files are uploaded through the
app and stored in a Unity Catalog volume; locally they go to a folder on disk. Text is
extracted on upload and kept with the document record. Allowed types are PDF, Word and
Excel, 25 MB at most. The file storage port keeps the two implementations interchangeable.
