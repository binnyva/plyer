# Plyer

This is a video player that functions at a folder level. Reads the `.playr.sqlite` db if it exists to load all info about this folder. If opened with a file as argument, try going up upto 3 levels to see if the DB can be found.

## Features

- Tag Videos
- Rate Videos
- Dynamic Playlist Based on Tags, Ratings
- Multiple Instances of app supported
- Stores all tag and rating data in SQLite DB
- Control using Media keys
- Dark mode/light mode based on system

## Player Toolbar

- Previous Video
- Play/Pause
- Next Video
- Tag > Opens Menu will 10 most common tags with checkboxs next to them
- Rating > Opens Menus with 0(no rating), 1, 2, 3, 4, 5. If video has rating already, that's shown
- Playlist - Toggle
- Video Seek bar
- Volume Level bar
- Mute

## Playlist Fields

When user clicks on playlist, it opens to the right side of the video. Both video and playlist will be shown at the same time.

- Title
- File Name
- Tags
- Ratings
- Duration

### Playlist Toolbar

- Sort Order > Playlist Order, Filename, File Creating time, Random
- Loop Playlist - Toggle
- Dynamic Playlist > Ratings(opens menu with 0-5), Tags(Opens menu with 10 most common tags) 

## Tech Stack

- React
- Electron - it has to work with Mac, Linux and Windows