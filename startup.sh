export DISPLAY=:0
export XAUTHORITY=/home/elijah/.Xauthority
cd /home/elijah/Desktop/3D-Model-Pi-Display
npx http-server . &      
sleep 3
chromium-browser \
  --noerrdialogs \
  --disable-infobars \
  --kiosk \
  http://127.0.0.1:8080/Code/pi.html &