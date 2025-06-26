def getBiggerVal():
	return 1

def plot(arg):
	return arg




# My question needs a setup of two magic functions: 
# 1. getBiggerVal() => every time it's called, returns a larger number than it did the prev time 
# and is larger by the same amount every time. Eg: 1, 2, 3, 4, ...
# 2. plot(coords) => magically graphs coordinates. Adds a dot/plots at the position of the coords argument
import math

coords = {"x": 0, "y": 0, "z": 0}

# would loop forever and adds a dot/plots every manipulation you do
while True: 
	val = getBiggerVal()

	coords.x = 2 * math.cos( val )
	coords.z = 2 * math.sin( val )
	coords.y = 2 * math.sin( val )

	plot(coords)

