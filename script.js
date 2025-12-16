$(document).ready(function () {
  console.log("App initialized");

  const triggerBtn = document.getElementById("nearby-trigger-btn");
  const contentDiv = document.getElementById("nearby-content");
  const paginationDiv = document.getElementById("pagination-controls");
  const distanceFilter = document.getElementById("distance-filter");
  const startDateFilter = document.getElementById("start-date-filter");
  const endDateFilter = document.getElementById("end-date-filter");
  const cityAutocompleteFilter = document.getElementById("city-autocomplete-filter");

  // PAGINATION SETTINGS
  const ITEMS_PER_PAGE = 18;
  let currentPage = 1;
  let currentFilteredData = [];

  flatpickr(startDateFilter, { dateFormat: "Y-m-d", altInput: true, altFormat: "M j, Y" });
  flatpickr(endDateFilter, { dateFormat: "Y-m-d", altInput: true, altFormat: "M j, Y" });

  let searchOrigin = null;
  let userCoords = null;
  let allEventsCache = null;
  let allCitiesCache = null;

  if(triggerBtn) triggerBtn.textContent = "Refresh";

  // Load Cities for Autocomplete
  $.getJSON('cities.json', function(data) {
    allCitiesCache = data;
  });

  $(cityAutocompleteFilter).autocomplete({
    source: function(request, response) {
      if (!allCitiesCache) return;
      const term = request.term.toLowerCase();
      const matches = allCitiesCache.filter(c =>
        c.city.toLowerCase().includes(term) || c.state.toLowerCase().includes(term)
      ).map(c => ({
        label: `${c.city}, ${c.state}`,
        value: `${c.city}, ${c.state}`,
        lat: c.lat,
        lng: c.lng
      }));
      response(matches);
    },
    minLength: 2,
    select: function(event, ui) {
      if (ui.item) {
        searchOrigin = { latitude: ui.item.lat, longitude: ui.item.lng };
        $(this).val(ui.item.value);
        fetchAndRenderLocations();
        return false;
      }
    }
  });

  const extractLatLng = (htmlString) => {
    const latMatch = htmlString.match(/meta property="latitude" content="([\d.-]+)"/);
    const lngMatch = htmlString.match(/meta property="longitude" content="([\d.-]+)"/);
    if (latMatch && lngMatch) {
      return { lat: parseFloat(latMatch[1]), lng: parseFloat(lngMatch[1]) };
    }
    return { lat: null, lng: null };
  };

  const stripHtml = (html) => {
    let tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  };

  const fetchAndRenderLocations = async () => {
    const originPoint = searchOrigin || userCoords;

    if (!originPoint) {
      contentDiv.innerHTML = '<div class="nearby-message">Could not get location. Please allow access or search a city.</div>';
      return;
    }

    contentDiv.innerHTML = '<div class="nearby-loader">Loading...</div>';
    paginationDiv.innerHTML = '';

    if (!allEventsCache) {
      try {
        const response = await fetch('events.json');
        allEventsCache = await response.json();
      } catch (error) {
        console.error("Error loading events.json", error);
        contentDiv.innerHTML = "Error loading data.";
        return;
      }
    }

    const normalizedData = allEventsCache.map(item => {
      const coords = extractLatLng(item.field_geolocation);

      // IMAGE URL with Fallback
      let imageUrl = "./fallback.jpg"; 
      if (item.field_preview_image && item.field_preview_image.trim() !== "") {
         if (item.field_preview_image.startsWith("/")) {
             imageUrl = "https://www.visitnj.org" + item.field_preview_image;
         } else {
             imageUrl = item.field_preview_image;
         }
      }

      // LINK URL with Fallback
      let itemLink = item.field_website;
      if (!itemLink || itemLink.trim() === "") {
         if (item.view_node) {
            itemLink = "https://www.visitnj.org" + item.view_node;
         } else {
            itemLink = "#";
         }
      }

      return {
        title: stripHtml(item.title),
        lat: coords.lat,
        lng: coords.lng,
        event_start: new Date(item.field_event_dates_value).getTime() / 1000,
        website: itemLink, 
        image: imageUrl,
        field_city: item.field_city_term,
        field_address: item.field_address,
        mapAddress: `${item.field_address}, ${item.field_city_term}, NJ ${item.field_zip_code_events}`
      };
    });

    currentPage = 1;
    filterAndProcessData(normalizedData, originPoint.latitude, originPoint.longitude);
  };

  // FILTER LOGIC
  const filterAndProcessData = (data, searchLat, searchLng) => {
    const [dist_min, dist_max] = distanceFilter.value.split('-').map(Number);
    const startDateVal = startDateFilter.value;
    const endDateVal = endDateFilter.value;

    const calculateDistance = (lat1, lon1, lat2, lon2) => {
      if ((lat1 == lat2) && (lon1 == lon2)) return 0;
      const radlat1 = Math.PI * lat1 / 180;
      const radlat2 = Math.PI * lat2 / 180;
      const theta = lon1 - lon2;
      const radtheta = Math.PI * theta / 180;
      let dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
      if (dist > 1) dist = 1;
      dist = Math.acos(dist);
      dist = dist * 180 / Math.PI;
      return dist * 60 * 1.1515;
    };

    currentFilteredData = data.map(item => {
      item.calculated_distance = calculateDistance(searchLat, searchLng, item.lat, item.lng);
      return item;
    })
    .filter(item => {
      if (item.calculated_distance < dist_min || item.calculated_distance > dist_max) return false;
      
      const itemDate = new Date(item.event_start * 1000);
      
      if (startDateVal && itemDate < new Date(startDateVal)) return false;
      if (endDateVal && itemDate > new Date(endDateVal)) return false;

      return true;
    })
    .sort((a, b) => a.calculated_distance - b.calculated_distance);

    renderPage();
  };

  // RENDER PAGE LOGIC
  const renderPage = () => {
    contentDiv.innerHTML = "";
    paginationDiv.innerHTML = "";

    if (currentFilteredData.length === 0) {
      contentDiv.innerHTML = '<div class="nearby-message">No results found within this range.</div>';
      return;
    }

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const pageData = currentFilteredData.slice(startIndex, endIndex);

    const gridContainer = document.createElement('div');
    gridContainer.className = 'results-grid-3-col'; 

    // RENDER EVENTS
    pageData.forEach(item => {
      const dateObj = new Date(item.event_start * 1000);
      const monthStr = dateObj.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      const dayStr = dateObj.toLocaleDateString('en-US', { day: 'numeric' });
      const yearStr = dateObj.getFullYear();
      
      const directionsUrl = `https://maps.google.com/maps?daddr=$${encodeURIComponent(item.mapAddress)}`;

      const cardHtml = `
        <div class="event-card">
            <div class="event-date-badge">
                <span class="badge-month">${monthStr}</span>
                <span class="badge-day">${dayStr}</span>
                <span class="badge-year">${yearStr}</span>
            </div>

            <a href="${item.website}" target="_blank" class="event-img-wrapper">
                <img src="${item.image}" 
                     alt="${item.title}" 
                     class="event-img"
                     onerror="this.onerror=null;this.src='/fallback.jpg';">
            </a>
            
            <div class="event-content">
                <h3 class="event-title">${item.title}</h3>
                
                <div class="event-meta-row">
                    <div>
                        <span style="display:block; font-weight:800;">${item.calculated_distance.toFixed(1)} MI</span>
                        <span style="font-weight:400;">Distance</span>
                    </div>
                    <div style="text-align:right;">
                        <span style="display:block; font-weight:800; text-transform:uppercase;">${item.field_city}</span>
                        <span style="font-weight:400;">Location</span>
                    </div>
                </div>

                <div class="event-actions">
                    <a href="${directionsUrl}" target="_blank" class="btn-action-small">Directions</a>
                    <a href="${item.website}" target="_blank" class="btn-action-small">Details</a>
                </div>
            </div>
        </div>
      `;
      gridContainer.insertAdjacentHTML('beforeend', cardHtml);
    });

    contentDiv.appendChild(gridContainer);

    // RENDER PAGINATION CONTROLS
    renderPaginationControls();
  };

  const renderPaginationControls = () => {
    const totalPages = Math.ceil(currentFilteredData.length / ITEMS_PER_PAGE);
    
    if (totalPages <= 1) return; 

    // Previous Button
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '←';
    prevBtn.className = `page-btn ${currentPage === 1 ? 'disabled' : ''}`;
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => {
        if (currentPage > 1) {
            currentPage--;
            renderPage();
            // Scroll
            const controlsTop = document.querySelector('.controls-wrapper').getBoundingClientRect().top + window.scrollY;
            window.scrollTo({ top: controlsTop - 20, behavior: 'smooth' });
        }
    };
    paginationDiv.appendChild(prevBtn);

    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }

    if (startPage > 1) {
        const firstBtn = document.createElement('button');
        firstBtn.textContent = '1';
        firstBtn.className = 'page-btn';
        firstBtn.onclick = () => { currentPage = 1; renderPage(); window.scrollTo({ top: document.querySelector('.controls-wrapper').getBoundingClientRect().top + window.scrollY - 20, behavior: 'smooth' }); };
        paginationDiv.appendChild(firstBtn);
        
        if (startPage > 2) {
            const dots = document.createElement('span');
            dots.textContent = '...';
            dots.style.alignSelf = 'center';
            dots.style.fontWeight = 'bold';
            paginationDiv.appendChild(dots);
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.textContent = i;
        btn.className = `page-btn ${i === currentPage ? 'active' : ''}`;
        btn.onclick = () => {
            currentPage = i;
            renderPage();
            const controlsTop = document.querySelector('.controls-wrapper').getBoundingClientRect().top + window.scrollY;
            window.scrollTo({ top: controlsTop - 20, behavior: 'smooth' });
        };
        paginationDiv.appendChild(btn);
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const dots = document.createElement('span');
            dots.textContent = '...';
            dots.style.alignSelf = 'center';
            dots.style.fontWeight = 'bold';
            paginationDiv.appendChild(dots);
        }
        const lastBtn = document.createElement('button');
        lastBtn.textContent = totalPages;
        lastBtn.className = 'page-btn';
        lastBtn.onclick = () => { currentPage = totalPages; renderPage(); window.scrollTo({ top: document.querySelector('.controls-wrapper').getBoundingClientRect().top + window.scrollY - 20, behavior: 'smooth' }); };
        paginationDiv.appendChild(lastBtn);
    }

    // Next Button
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '→';
    nextBtn.className = `page-btn ${currentPage === totalPages ? 'disabled' : ''}`;
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.onclick = () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderPage();
            const controlsTop = document.querySelector('.controls-wrapper').getBoundingClientRect().top + window.scrollY;
            window.scrollTo({ top: controlsTop - 20, behavior: 'smooth' });
        }
    };
    paginationDiv.appendChild(nextBtn);
  };

  // GEOLOCATION LOGIC
  const triggerGeolocationAndFetch = () => {
    triggerBtn.textContent = "Locating...";
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          userCoords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
          triggerBtn.textContent = "Refresh";
          fetchAndRenderLocations();
        },
        () => {
          triggerBtn.textContent = "Permission needed";
          userCoords = { latitude: 39.495, longitude: -74.460 };
          fetchAndRenderLocations();
        }
      );
    } else {
        triggerBtn.textContent = "Geolocation not supported";
    }
  };

  triggerBtn.addEventListener("click", triggerGeolocationAndFetch);
  distanceFilter.addEventListener("change", fetchAndRenderLocations);
  startDateFilter.addEventListener("change", fetchAndRenderLocations);
  endDateFilter.addEventListener("change", fetchAndRenderLocations);

  triggerGeolocationAndFetch();
});