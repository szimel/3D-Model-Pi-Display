# 3D-Model-Pi-Display

npm run build => dist/bundle.js => run using npx http-server . @http://127.0.0.1:8080/Code/pi.html

Expects a folder named Models in root, with files "stool.glb" and "brush_2.glb"

If it's not working, delete dist folder, rerun build

on boot => use terminal: "crontab -e" => add this line at bottom: "@reboot /home/pi-name/Desktop/3D-Model-Pi-Display/startup.sh"
