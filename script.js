// ======================
// INIT MAP
// ======================
const map = L.map("map").setView([56.157, 10.16], 13);

map.on("moveend", loadCurrentWeather);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
   maxZoom: 19,
   attribution: "&copy; OpenStreetMap"
}).addTo(map);

let routeLayer;
let markers = [];
let loading = false;


// ======================
// ENTER KEY SUPPORT
// ======================
function handleEnter(e){
   if(e.key === "Enter"){
       e.preventDefault();
       findRoute();
   }
}

window.addEventListener("load", () => {
   document.getElementById("from").addEventListener("keydown", handleEnter);
   document.getElementById("to").addEventListener("keydown", handleEnter);

   loadCurrentWeather();
});


// ======================
// FIND ROUTE
// ======================
async function findRoute(){

   if(loading) return;

   loading = true;

   const btn = document.getElementById("routeBtn");
   btn.disabled = true;
   btn.textContent = "Loading route...";

   try{
       const fromText = document.getElementById("from").value.trim();
       const toText = document.getElementById("to").value.trim();

       if(!fromText || !toText){
           alert("Write both locations");
           return;
       }

       const start = await geocode(fromText);
       const end = await geocode(toText);

       if(!start || !end){
           alert("Location not found");
           return;
       }

       drawMarkers(start, end);

       const routeData = await drawLine(start, end);

       const distance = routeData.distance / 1000;

       const startWeather = await getWeather(start);
       const endWeather = await getWeather(end);

       showInfo(distance, startWeather, endWeather);

       saveRoute(fromText, toText);

   } catch(error){
       console.error(error);
       alert("Something went wrong");
   } finally{
       loading = false;
       btn.disabled = false;
       btn.textContent = "Find Rute";
   }
}


// ======================
// GEOCODE
// ======================
async function geocode(place){

   const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place + ", Denmark")}`;

   const res = await fetch(url);
   const data = await res.json();

   if(data.length === 0) return null;

   return {
       lat: parseFloat(data[0].lat),
       lon: parseFloat(data[0].lon)
   };
}


// ======================
// DRAW MARKERS
// ======================
function drawMarkers(start, end){

   markers.forEach(m => map.removeLayer(m));
   markers = [];

   const m1 = L.marker([start.lat, start.lon]).addTo(map).bindPopup("Start");
   const m2 = L.marker([end.lat, end.lon]).addTo(map).bindPopup("Destination");

   markers.push(m1, m2);
}


// ======================
// DRAW LINE
// ======================
async function drawLine(start, end){

   if(routeLayer){
       map.removeLayer(routeLayer);
   }

   const url = `https://router.project-osrm.org/route/v1/bicycle/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`;

   const res = await fetch(url);
   const data = await res.json();

   if(!data.routes || data.routes.length === 0){
       alert("No route found");
       return;
   }

   const routeData = data.routes[0];

   const coords = routeData.geometry.coordinates;
   const latlngs = coords.map(c => [c[1], c[0]]);

   routeLayer = L.polyline(latlngs, {
       color: "#0047ff",
       weight: 5
   }).addTo(map);

   map.fitBounds(routeLayer.getBounds());

   return routeData;
}


// ======================
// WEATHER
// ======================
async function getWeather(point){

   const url = `https://api.open-meteo.com/v1/forecast?latitude=${point.lat}&longitude=${point.lon}&current_weather=true&wind_speed_unit=ms`;

   const res = await fetch(url);
   const data = await res.json();

   return data.current_weather;
}


// ======================
// LOAD WEATHER BOX
// ======================
async function loadCurrentWeather(){

   const center = map.getCenter();

   const w = await getWeather({
       lat: center.lat,
       lon: center.lng
   });

   document.getElementById("weatherBox").innerHTML = `
       ${w.windspeed} m/s &nbsp;&nbsp; ${w.temperature}°C
       <span>(live data)</span>
   `;
}


// ======================
// SHOW INFO (UPDATED)
// ======================
function showInfo(distance, startW, endW){

   const el = document.getElementById("routeInfo");
   if(!el) return;

   const bikeType = localStorage.getItem("bikeType") || "road";

   const speed = getBikeSpeed();
   const duration = Math.round((distance / speed) * 60);

   const difficulty = calculateDifficulty(startW.windspeed, bikeType);

   const timing = calculateLeaveEarlier(distance, speed, startW.windspeed, bikeType);

    el.innerHTML = `
    <strong>${distance.toFixed(1)} km</strong> • ${timing.adjustedTime} min 🚴<br><br>

    ⏱ Normal tid: ${timing.baseTime} min.<br>
    ⏱ Din tid: ${timing.adjustedTime} min.<br><br>

    ⏰ Cykel <strong>${timing.extraMinutes} min. før</strong><br><br>

    🌤 Start: ${startW.temperature}°C, ${startW.windspeed} m/s<br>
    🌤 Slut: ${endW.temperature}°C, ${endW.windspeed} m/s<br><br>

    Vind modstand: <strong>${difficulty.level}</strong>
    `;
}


// ======================
// BIKE SETTINGS
// ======================
function saveSettings(){

   const selected = document.querySelector('input[name="bike"]:checked');

   if(selected){
       localStorage.setItem("bikeType", selected.value);

       if(selected.value === "custom"){
           const speedInput = document.getElementById("customSpeed").value;
           if(speedInput){
               localStorage.setItem("customSpeed", speedInput);
           }
       }
   }

   closeSettings();
}

function calculateLeaveEarlier(distance, speed, windSpeed, bikeType){

   const baseTime = (distance / speed) * 60; // minutes

   const difficulty = calculateDifficulty(windSpeed, bikeType);

   let penalty = 0;

   if(difficulty.level === "Let vind") penalty = 0;
   else if(difficulty.level === "Frisk vind") penalty = 0.1;
   else if(difficulty.level === "Hård vind") penalty = 0.25;
   else if(difficulty.level === "Storm styrke") penalty = 0.5;

   const adjustedTime = baseTime * (1 + penalty);

   const extraMinutes = Math.round(adjustedTime - baseTime);

   return {
       baseTime: Math.round(baseTime),
       adjustedTime: Math.round(adjustedTime),
       extraMinutes
   };
}

// ======================
// BIKE SPEED
// ======================
function getBikeSpeed(){

   const type = localStorage.getItem("bikeType") || "road";

   if(type === "road") return 15;
   if(type === "ebike") return 25;

   if(type === "custom"){
       const custom = parseFloat(localStorage.getItem("customSpeed"));
       return custom || 15;
   }

   return 15;
}


// ======================
// DIFFICULTY SYSTEM
// ======================
function bikeFactor(type){
   switch(type){
       case "road": return 1.0;
       case "city": return 1.2;
       case "mtb": return 1.3;
       case "ebike": return 0.8;
       case "custom": return 1.0;
       default: return 1.0;
   }
}

function getBeaufort(ms){
   if(ms < 0.3) return 0;
   if(ms < 1.6) return 1;
   if(ms < 3.4) return 2;
   if(ms < 5.5) return 3;
   if(ms < 8.0) return 4;
   if(ms < 10.8) return 5;
   if(ms < 13.9) return 6;
   if(ms < 17.2) return 7;
   if(ms < 20.8) return 8;
   if(ms < 24.5) return 9;
   if(ms < 28.5) return 10;
   if(ms < 32.7) return 11;
   return 12;
}

function calculateDifficulty(windSpeed, bikeType){

   const beaufort = getBeaufort(windSpeed);
   const factor = bikeFactor(bikeType);

   const score = beaufort * factor;

   let level = "";

   if(score < 3){
       level = "Let vind";
   } else if(score < 6){
       level = "Frisk vind";
   } else if(score < 9){
       level = "Hård vind";
   } else {
       level = "Storm styrke";
   }

   return { level, beaufort };
}


// ======================
// GPS
// ======================
function getLocation(){

   navigator.geolocation.getCurrentPosition((pos)=>{
       const lat = pos.coords.latitude;
       const lon = pos.coords.longitude;

       document.getElementById("from").value = `${lat}, ${lon}`;
       map.setView([lat, lon], 15);
   });
}


// ======================
// SAVE ROUTES
// ======================
function saveRoute(from, to){

   let routes = JSON.parse(localStorage.getItem("routes")) || [];
   routes.push({from, to});

   localStorage.setItem("routes", JSON.stringify(routes));
}


// ======================
// SHOW SAVED ROUTES
// ======================
function showSavedRoutes(){

   let routes = JSON.parse(localStorage.getItem("routes")) || [];

   if(routes.length === 0){
       alert("No saved routes");
       return;
   }

   let text = "Saved Routes:\n\n";

   routes.forEach((r, i)=>{
       text += `${i+1}. ${r.from} ➜ ${r.to}\n`;
   });

   alert(text);
}


function toggleCustomSpeed(){
   console.log("TOGGLE RUNNING");

   const selected = document.querySelector('input[name="bike"]:checked').value;
   const input = document.getElementById("customSpeed");

   if(selected === "custom"){
       input.style.display = "block";
   } else {
       input.style.display = "none";
   }
}


// ====================
// FEEDBACK LOKATION
// ====================
let feedbackMap;
let feedbackMarker;
let selectedLocation = null;

function openLocationPicker(){
    console.log("OPEN CLICK WORKS");

   // hide feedback modal first
   document.getElementById("feedbackModal").style.display = "none";

   // show location modal
   document.getElementById("locationModal").style.display = "flex";

   setTimeout(()=>{

      if(!feedbackMap){

         feedbackMap = L.map("feedbackMap").setView([56.157,10.16],13);

         L.tileLayer(
         "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
         ).addTo(feedbackMap);

         feedbackMap.on("click",(e)=>{

            selectedLocation = e.latlng;

            if(feedbackMarker){
               feedbackMap.removeLayer(feedbackMarker);
            }

            feedbackMarker = L.marker(e.latlng).addTo(feedbackMap);

         });

      }

      feedbackMap.invalidateSize();

   },200);
}

function closeLocationPicker(){
document.getElementById("locationModal").style.display="none";
}

function saveLocation(){

if(!selectedLocation){
alert("Vælg først en lokalitet");
return;
}

closeLocationPicker();
alert("Lokalitet gemt");

}

function submitFeedback(){

   const text = document.getElementById("feedbackText").value.trim();

   if(!text){
       alert("Skriv feedback først");
       return;
   }

   const feedback = {
       text: text,
       location: selectedLocation || null,
       time: new Date().toISOString()
   };

   let allFeedback = JSON.parse(localStorage.getItem("feedback")) || [];
   allFeedback.push(feedback);

   localStorage.setItem("feedback", JSON.stringify(allFeedback));

   alert("Feedback gemt ✅");

   document.getElementById("feedbackText").value = "";
   selectedLocation = null;

   closeFeedback();
}


function openSettings(){
   document.getElementById("settingsModal").style.display = "flex";
}

function closeSettings(){
   document.getElementById("settingsModal").style.display = "none";
}

function openFeedback(){
   document.getElementById("feedbackModal").style.display = "flex";
}

function closeFeedback(){
   document.getElementById("feedbackModal").style.display = "none";
}

