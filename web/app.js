

/* =====================================================
   SUPABASE
===================================================== */

const db = OurDateStore.client;

/* =====================================================
   GLOBAL STATE
===================================================== */

let viewingMonth =
  new Date();


viewingMonth =
  new Date(
    viewingMonth.getFullYear(),
    viewingMonth.getMonth(),
    1
  );


let monthPickerYear =
  viewingMonth
    .getFullYear();


let selectedDate = null;

let currentCategory = null;

let editingPlaceIndex = null;

let currentTimeTarget = null;

let appData = {};

let pendingPhotoFiles = [];

let existingPhotoImages = [];

let importedPhotoImages = [];

let removedExistingPhotos = [];

let previousPlaceRecords = [];

let imageViewerImages = [];

let imageViewerIndex = 0;

let imageViewerTouchStartX = null;

let pendingDeleteIndex = null;

let kakaoPlaceResults = [];

let dateMap = null;

let dateMapInfoWindow = null;

let dateMapMarkerEntries = {};


const FREE_STORAGE_LIMIT_BYTES =
  1024 * 1024 * 1024;

const PHOTO_MAX_DIMENSION =
  1600;

const PHOTO_TARGET_BYTES =
  900 * 1024;

const STORAGE_USAGE_POLL_INTERVAL_MS =
  5 * 60 * 1000;

let storageUsagePollTimer = null;
let dateFormSnapshot = null;
let dateSaveInFlight = null;
let placeSaveInFlight = false;
let deletePlaceInFlight = false;
let placeEditorId = null;
let placeEditorPersisted = false;
let placeEditorDate = null;
let placeEditorCategory = null;
let dateLoadSequence = new Map();
let navigationSequence = 0;

function newRecordId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  return [...bytes].map((b, i) => ([4, 6, 8, 10].includes(i) ? "-" : "") + b.toString(16).padStart(2, "0")).join("");
}


function dateFormFromRow(row) {
  return { startTime: normalizeTime(row?.start_time), endTime: normalizeTime(row?.end_time), memo: row?.memo || "" };
}

function fillDateForm(form) {
  document.getElementById("startTime").value = form.startTime;
  document.getElementById("endTime").value = form.endTime;
  document.getElementById("dateMemo").value = form.memo;
  updateTimeDisplays();
}

function askAppChoice(title, description, choices) {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", title);
    Object.assign(dialog.style, { border: "1px solid #ecdeda", borderRadius: "24px", padding: "26px", width: "min(440px, calc(100vw - 32px))", margin: "auto", color: "#423833", background: "#fffcf8", boxShadow: "0 24px 80px #39211a40" });
    const heading = document.createElement("h2");
    heading.textContent = title;
    heading.style.fontSize = "20px";
    const message = document.createElement("p");
    message.textContent = description;
    Object.assign(message.style, { whiteSpace: "pre-wrap", lineHeight: "1.65", margin: "18px 0", fontSize: "14px" });
    dialog.append(heading, message);
    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      dialog.close(); dialog.remove(); resolve(value);
    }
    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = choice.label;
      Object.assign(button.style, { display: "block", width: "100%", marginTop: "10px", padding: "12px", borderRadius: "12px", border: "1px solid #e8dcd6", background: choice.value === "cancel" ? "transparent" : "#f5e9e4", color: "inherit" });
      button.addEventListener("click", () => finish(choice.value));
      dialog.appendChild(button);
    }
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish("cancel"); });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

function placeFormSignature() {
  return JSON.stringify({
    name: document.getElementById("placeName").value,
    address: document.getElementById("placeAddress").value,
    latitude: document.getElementById("placeLatitude").value,
    longitude: document.getElementById("placeLongitude").value,
    memo: document.getElementById("placeMemo").value,
    images: existingPhotoImages.map(image => image.id || image.storagePath),
    pending: pendingPhotoFiles.map(image => image.id),
    imported: importedPhotoImages.map(image => image.storagePath),
    removed: removedExistingPhotos.map(image => image.id)
  });
}
let placeEditorBaseline = "";

function readDateForm() {
  return {
    startTime: document.getElementById("startTime").value,
    endTime: document.getElementById("endTime").value,
    memo: document.getElementById("dateMemo").value.trim()
  };
}

function sameDateForm(left, right) {
  return left.startTime === right.startTime && left.endTime === right.endTime && left.memo === right.memo;
}

function captureDateFormSnapshot(data = getDateData()) {
  dateFormSnapshot = { dateKey: selectedDate, id: data.id, updatedAt: data.updatedAt || null, ...readDateForm() };
}

async function signedImageUrl(storagePath) {
  const { data, error } = await db.storage.from("place-images").getPublicUrl(storagePath);
  if (error) throw error;
  if (!data?.publicUrl) throw new Error("사진 주소를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
  return data.publicUrl;
}



/* =====================================================
   LOADING
===================================================== */

function showLoading(
  text = "불러오는 중..."
) {

  document
    .getElementById(
      "loadingText"
    )
    .textContent =
    text;


  document
    .getElementById(
      "loadingOverlay"
    )
    .classList
    .add(
      "active"
    );

}


function hideLoading() {

  document
    .getElementById(
      "loadingOverlay"
    )
    .classList
    .remove(
      "active"
    );

}


/* =====================================================
   SUCCESS POPUP
===================================================== */

function showSuccessModal(
  title,
  message = ""
) {

  document
    .getElementById(
      "successTitle"
    )
    .textContent =
    title;


  const messageElement =
    document
      .getElementById(
        "successMessage"
      );


  messageElement.textContent =
    message;


  messageElement.style.display =
    message
    ?
    "block"
    :
    "none";


  document
    .getElementById(
      "successOverlay"
    )
    .classList
    .add(
      "active"
    );

}


function closeSuccessModal() {

  document
    .getElementById(
      "successOverlay"
    )
    .classList
    .remove(
      "active"
    );

}


document
  .getElementById(
    "successOverlay"
  )
  .addEventListener(
    "click",
    function(event) {

      if (
        event.target === this
      ) {

        closeSuccessModal();

      }

    }
  );


/* =====================================================
   EMPTY DATE
===================================================== */

function createEmptyDate(dateKey = selectedDate) {

  return {

    id: null,

    date:
      dateKey,

    startTime: "",

    endTime: "",

    memo: "",

    places: {

      restaurant: [],

      cafe: [],

      activity: []

    }

  };

}


/* =====================================================
   TIME NORMALIZE
===================================================== */

function normalizeTime(
  time
) {

  if (!time) {
    return "";
  }


  return String(time)
    .slice(
      0,
      5
    );

}


/* =====================================================
   SERVER DATA LOAD

   달력에서는 해당 월의 최소 데이터만,
   날짜/후보/지도에서는 선택한 날짜만 불러온다.
===================================================== */

function makeDateDataFromRow(
  row
) {

  return {
    updatedAt: row.updated_at || null,

    id:
      row.id,

    date:
      row.date,

    startTime:
      normalizeTime(
        row.start_time
      ),

    endTime:
      normalizeTime(
        row.end_time
      ),

    memo:
      row.memo || "",

    places: {

      restaurant: [],

      cafe: [],

      activity: []

    }

  };

}


function formatDateForQuery(
  date
) {

  return (
    date.getFullYear()
    +
    "-"
    +
    String(
      date.getMonth() + 1
    )
    .padStart(
      2,
      "0"
    )
    +
    "-"
    +
    String(
      date.getDate()
    )
    .padStart(
      2,
      "0"
    )
  );

}


async function loadMonthData() {

  const year =
    viewingMonth
      .getFullYear();


  const month =
    viewingMonth
      .getMonth();


  const monthStart =
    new Date(
      year,
      month,
      1
    );


  const nextMonthStart =
    new Date(
      year,
      month + 1,
      1
    );


  const startKey =
    formatDateForQuery(
      monthStart
    );


  const endKey =
    formatDateForQuery(
      nextMonthStart
    );


  const {
    data: dates,
    error: datesError
  } =
    await db
      .from(
        "dates"
      )
      .select(
        "id,date,start_time,end_time,memo,updated_at"
      )
      .gte(
        "date",
        startKey
      )
      .lt(
        "date",
        endKey
      );


  if (
    datesError
  ) {

    throw datesError;

  }


  const monthData = {};


  for (
    const row of
    dates || []
  ) {

    monthData[
      row.date
    ] =
      makeDateDataFromRow(
        row
      );

  }


  const dateIds =
    (dates || [])
      .map(
        row => row.id
      );


  if (
    dateIds.length > 0
  ) {

    const {
      data: places,
      error: placesError
    } =
      await db
        .from(
          "places"
        )
        .select(
          "id,date_id,category"
        )
        .in(
          "date_id",
          dateIds
        );


    if (
      placesError
    ) {

      throw placesError;

    }


    const dateIdMap = {};


    for (
      const row of
      dates || []
    ) {

      dateIdMap[
        row.id
      ] =
        row.date;

    }


    for (
      const place of
      places || []
    ) {

      const dateKey =
        dateIdMap[
          place.date_id
        ];


      if (
        !dateKey
        ||
        !monthData[
          dateKey
        ]
        ?.places[
          place.category
        ]
      ) {

        continue;

      }


      /*
        달력은 후보 개수만 알면 되므로
        장소 상세/사진은 가져오지 않는다.
      */
      monthData[
        dateKey
      ]
      .places[
        place.category
      ]
      .push({
        id:
          place.id
      });

    }

  }


  /*
    현재 보고 있는 월의 오래된 캐시만 지우고
    다른 월/선택 날짜 캐시는 유지한다.
  */
  for (
    const key of
    Object.keys(
      appData
    )
  ) {

    if (
      key >= startKey
      &&
      key < endKey
    ) {

      delete appData[
        key
      ];

    }

  }


  Object.assign(
    appData,
    monthData
  );

}


async function loadSelectedDateData(dateKey = selectedDate) {
  const requestId = (dateLoadSequence.get(dateKey) || 0) + 1;
  dateLoadSequence.set(dateKey, requestId);

  if (
    !dateKey
  ) {

    return;

  }


  const {
    data: dateRows,
    error: dateError
  } =
    await db
      .from(
        "dates"
      )
      .select(
        "id,date,start_time,end_time,memo,updated_at"
      )
      .eq(
        "date",
        dateKey
      )
      .limit(
        1
      );


  if (
    dateError
  ) {

    throw dateError;

  }


  if (dateLoadSequence.get(dateKey) !== requestId) return;

  const dateRow =
    dateRows?.[0];


  if (
    !dateRow
  ) {

    appData[
      dateKey
    ] =
      createEmptyDate(dateKey);


    return;

  }


  const dateData =
    makeDateDataFromRow(
      dateRow
    );


  const {
    data: places,
    error: placesError
  } =
    await db
      .from(
        "places"
      )
      .select("*")
      .eq(
        "date_id",
        dateRow.id
      )
      .order(
        "created_at",
        {
          ascending: true
        }
      );


  if (
    placesError
  ) {

    throw placesError;

  }


  const placeIds =
    (places || [])
      .map(
        place =>
          place.id
      );


  let images = [];


  if (
    placeIds.length > 0
  ) {

    const response =
      await db
        .from(
          "place_images"
        )
        .select("*")
        .in(
          "place_id",
          placeIds
        )
        .order(
          "created_at",
          {
            ascending: true
          }
        );


    if (
      response.error
    ) {

      throw response.error;

    }


    images =
      response.data || [];

  }


  const imageByPlace = {};


  for (
    const image of
    images
  ) {

    if (
      !imageByPlace[
        image.place_id
      ]
    ) {

      imageByPlace[
        image.place_id
      ] = [];

    }


    const publicUrlData = { publicUrl: await signedImageUrl(image.storage_path) };


    imageByPlace[
      image.place_id
    ]
    .push({

      id:
        image.id,

      storagePath:
        image.storage_path,



      fileSize:

        Number(

          image.file_size

          ||

          0

        ),

      url:
        publicUrlData.publicUrl

    });

  }


  for (
    const place of
    places || []
  ) {

    if (
      !dateData
        .places[
          place.category
        ]
    ) {

      continue;

    }


    const placeImages =
      imageByPlace[
        place.id
      ]
      ||
      [];


    dateData
      .places[
        place.category
      ]
      .push({

        id:
          place.id,

        name:
          place.name,

        address:
          place.address || "",

        memo:
          place.memo || "",

        latitude:
          place.latitude,

        longitude:
          place.longitude,

        images:
          placeImages,

        image:
          placeImages.length > 0
          ?
          placeImages[0].url
          :
          null

      });

  }


  if (dateLoadSequence.get(dateKey) !== requestId) return;

  appData[
    dateKey
  ] =
    dateData;

}


async function loadServerData(
  scope = "date"
) {

  if (
    scope ===
    "month"
  ) {

    await loadMonthData();

    return;

  }


  if (
    selectedDate
  ) {

    await loadSelectedDateData();

    return;

  }


  await loadMonthData();

}


/* =====================================================
   REFRESH FROM SERVER

   ★ 화면 전환 때마다 이 함수를 호출
===================================================== */

async function refreshFromServer(
  loadingText = "최신 정보 불러오는 중...",
  scope = "date"
) {

  showLoading(
    loadingText
  );


  try {

    await loadServerData(
      scope
    );


    return true;

  } catch (error) {

    console.error(
      "서버 동기화 실패:",
      error
    );


    alert(
      "최신 정보를 불러오지 못했어.\n"
      +
      error.message
    );


    return false;

  } finally {

    hideLoading();

  }

}


/* =====================================================
   GET DATE DATA
===================================================== */

function getDateData() {

  return (

    appData[
      selectedDate
    ]

    ||

    createEmptyDate()

  );

}


/* =====================================================
   SCREEN
===================================================== */

function showScreen(
  id
) {

  document
    .querySelectorAll(
      ".screen"
    )
    .forEach(
      screen => {

        screen
          .classList
          .remove(
            "active"
          );

      }
    );


  document
    .getElementById(
      id
    )
    .classList
    .add(
      "active"
    );


  window.scrollTo(
    0,
    0
  );

}


/* =====================================================
   APP HISTORY / ANDROID BACK BUTTON

   한 HTML 안에서 화면만 바꾸는 SPA 구조이므로
   History API에 화면 이동 기록을 직접 남긴다.

   달력 → 날짜 → 카테고리/지도 순으로 들어갔다면
   안드로이드 뒤로가기와 브라우저 뒤로가기도
   반대 순서로 자연스럽게 돌아간다.
===================================================== */

function makeCalendarHistoryState() {

  return {

    ourDateApp:
      true,

    screen:
      "calendar",

    year:
      viewingMonth
        .getFullYear(),

    month:
      viewingMonth
        .getMonth()

  };

}


function pushAppHistory(
  screen,
  extra = {}
) {

  history.pushState(
    {

      ourDateApp:
        true,

      screen:
        screen,

      ...extra

    },
    ""
  );

}


function syncCalendarHistoryState() {

  const calendarScreen =
    document
      .getElementById(
        "calendarScreen"
      );


  if (
    !calendarScreen
    ||
    !calendarScreen
      .classList
      .contains(
        "active"
      )
  ) {

    return;

  }


  history.replaceState(
    makeCalendarHistoryState(),
    ""
  );

}


async function restoreAppHistoryState(
  state
) {
  const requestId = ++navigationSequence;

  if (
    !state
    ||
    !state.ourDateApp
  ) {

    return;

  }


  /*
    날짜 화면에서 달력으로 빠져나갈 때는
    사용자가 바꿔 둔 시간/메모를 기존 동작처럼 저장한다.
  */
  if (
    state.screen ===
    "calendar"
  ) {

    try {

      await saveDateInfo(
        false
      );

    } catch (error) {

      console.error("뒤로가기 저장 실패:", error);
      pushAppHistory("date", { date: selectedDate });
      showScreen("dateScreen");
      if (!error.keepEditing) alert("저장하지 못해 현재 화면에 머물렀어요.\n" + error.message);
      return;

    }


    if (
      Number.isInteger(
        state.year
      )
      &&
      Number.isInteger(
        state.month
      )
    ) {

      viewingMonth =
        new Date(
          state.year,
          state.month,
          1
        );

    }


    await refreshFromServer(
      "달력 업데이트 중...",
      "month"
    );


    if (requestId !== navigationSequence) return;
    refreshStorageUsage();


    showScreen(
      "calendarScreen"
    );


    renderCalendar();


    return;

  }


  if (
    state.date
  ) {

    selectedDate =
      state.date;

  }


  if (
    state.screen ===
    "date"
  ) {

    await refreshFromServer(
      "데이트 정보 확인 중...",
      "date"
    );


    if (requestId !== navigationSequence) return;
    showScreen(
      "dateScreen"
    );


    loadDateScreen();


    return;

  }


  if (
    state.screen ===
    "category"
  ) {

    if (!categoryInfo[state.category]) return;
    currentCategory =
      state.category;


    await refreshFromServer(
      "후보 불러오는 중...",
      "date"
    );


    if (requestId !== navigationSequence) return;
    document
      .getElementById(
        "categoryTitle"
      )
      .textContent =
      categoryInfo[
        currentCategory
      ]
      .title;


    document
      .getElementById(
        "addPlaceButton"
      )
      .textContent =
      categoryInfo[
        currentCategory
      ]
      .button;


    showScreen(
      "categoryScreen"
    );


    renderPlaceList();


    return;

  }


  if (
    state.screen ===
    "map"
  ) {

    const refreshed =
      await refreshFromServer(
        "지도 정보 불러오는 중...",
        "date"
      );


    if (
      !refreshed || requestId !== navigationSequence
    ) {

      return;

    }


    showScreen(
      "mapScreen"
    );


    setTimeout(
      function() {

        renderDateMap();

      },
      80
    );

  }

}


window
  .addEventListener(
    "popstate",
    function(event) {

      handleAppPopState(
        event.state
      )
      .catch(
        function(error) {

          console.error(
            "뒤로가기 화면 복원 실패:",
            error
          );

        }
      );

    }
  );



/* =====================================================
   GO CALENDAR

   ★ 저장 후 서버 최신 데이터 재조회
===================================================== */

async function goCalendar() {

  try {

    await saveDateInfo(
      false
    );

  } catch (error) {

    console.error(error);
    if (!error.keepEditing) alert("저장하지 못했어요. 입력한 내용은 유지했어요.\n" + error.message);
    return;

  }


  await refreshFromServer(
    "달력 업데이트 중...",
    "month"
  );


  refreshStorageUsage();


  showScreen(
    "calendarScreen"
  );


  renderCalendar();

}


/* =====================================================
   GO DATE SCREEN

   ★ 카테고리 → 날짜 화면 갈 때 서버 재조회
===================================================== */

async function goDateScreen() {

  await refreshFromServer(
    "데이트 정보 확인 중...",
    "date"
  );


  showScreen(
    "dateScreen"
  );


  loadDateScreen();

}


/* =====================================================
   DATE KEY
===================================================== */

function createDateKey(
  year,
  month,
  day
) {

  return (
    year
    +
    "-"
    +
    String(
      month + 1
    )
    .padStart(
      2,
      "0"
    )
    +
    "-"
    +
    String(
      day
    )
    .padStart(
      2,
      "0"
    )
  );

}


/* =====================================================
   CALENDAR
===================================================== */

function renderCalendar() {

  const calendar =
    document
      .getElementById(
        "calendar"
      );


  calendar.innerHTML =
    "";


  const year =
    viewingMonth
      .getFullYear();


  const month =
    viewingMonth
      .getMonth();


  document
    .getElementById(
      "monthTitle"
    )
    .textContent =
    `${year}년 ${month + 1}월`;


  const firstDay =
    new Date(
      year,
      month,
      1
    )
    .getDay();


  const lastDay =
    new Date(
      year,
      month + 1,
      0
    )
    .getDate();


  for (
    let i = 0;
    i < firstDay;
    i++
  ) {

    const empty =
      document
        .createElement(
          "div"
        );


    empty.className =
      "calendar-empty";


    calendar.appendChild(
      empty
    );

  }


  const today =
    new Date();


  for (
    let day = 1;
    day <= lastDay;
    day++
  ) {

    const key =
      createDateKey(
        year,
        month,
        day
      );


    const data =
      appData[
        key
      ];


    const button =
      document
        .createElement(
          "button"
        );


    button.type =
      "button";


    button.className =
      "calendar-day";


    button.textContent =
      day;


    if (
      today.getFullYear() === year
      &&
      today.getMonth() === month
      &&
      today.getDate() === day
    ) {

      button
        .classList
        .add(
          "today"
        );

    }


    if (
      hasDateContent(
        data
      )
    ) {

      button
        .classList
        .add(
          "has-content"
        );

    }


    if (
      hasDateTime(
        data
      )
    ) {

      button
        .classList
        .add(
          "has-time"
        );

    }


    button.onclick =
      function() {

        openDate(
          year,
          month,
          day
        );

      };


    calendar.appendChild(
      button
    );

  }


  syncCalendarHistoryState();

}


function hasDateTime(
  data
) {

  if (!data) {
    return false;
  }


  return Boolean(
    data.startTime
    &&
    data.endTime
  );

}


function hasDateContent(
  data
) {

  if (!data) {
    return false;
  }


  if (
    data.startTime
    ||
    data.endTime
    ||
    data.memo
  ) {

    return true;

  }


  return (

    (
      data.places
        ?.restaurant
        ?.length
      ||
      0
    )

    +

    (
      data.places
        ?.cafe
        ?.length
      ||
      0
    )

    +

    (
      data.places
        ?.activity
        ?.length
      ||
      0
    )

  ) > 0;

}


/* =====================================================
   MONTH PICKER
===================================================== */

function openMonthPicker() {

  monthPickerYear =
    viewingMonth
      .getFullYear();


  renderMonthPicker();


  document
    .getElementById(
      "monthPickerModal"
    )
    .classList
    .add(
      "active"
    );


  document
    .getElementById(
      "monthTitleButton"
    )
    .setAttribute(
      "aria-expanded",
      "true"
    );

}


function closeMonthPicker() {

  const modal =
    document
      .getElementById(
        "monthPickerModal"
      );


  if (
    modal
  ) {

    modal
      .classList
      .remove(
        "active"
      );

  }


  const button =
    document
      .getElementById(
        "monthTitleButton"
      );


  if (
    button
  ) {

    button
      .setAttribute(
        "aria-expanded",
        "false"
      );

  }

}


function handleMonthPickerBackground(
  event
) {

  if (
    event.target
      .id ===
    "monthPickerModal"
  ) {

    closeMonthPicker();

  }

}


function changeMonthPickerYear(
  amount
) {

  monthPickerYear +=
    amount;


  renderMonthPicker();

}


function renderMonthPicker() {

  const yearElement =
    document
      .getElementById(
        "monthPickerYear"
      );


  const grid =
    document
      .getElementById(
        "monthPickerGrid"
      );


  if (
    !yearElement
    ||
    !grid
  ) {

    return;

  }


  yearElement.textContent =
    `${monthPickerYear}`;


  grid.innerHTML =
    "";


  const today =
    new Date();


  for (
    let month = 0;
    month < 12;
    month++
  ) {

    const button =
      document
        .createElement(
          "button"
        );


    button.type =
      "button";


    button.className =
      "month-picker-month";


    button.textContent =
      `${month + 1}월`;


    if (
      viewingMonth
        .getFullYear()
        ===
      monthPickerYear
      &&
      viewingMonth
        .getMonth()
        ===
      month
    ) {

      button
        .classList
        .add(
          "current-view"
        );

    }


    if (
      today
        .getFullYear()
        ===
      monthPickerYear
      &&
      today
        .getMonth()
        ===
      month
    ) {

      button
        .classList
        .add(
          "today-month"
        );

    }


    button.onclick =
      function() {

        selectMonthFromPicker(
          month
        );

      };


    grid.appendChild(
      button
    );

  }

}


async function selectMonthFromPicker(
  month
) {

  viewingMonth =
    new Date(
      monthPickerYear,
      month,
      1
    );


  closeMonthPicker();


  await refreshFromServer(
    "달력 업데이트 중...",
    "month"
  );


  renderCalendar();

}


document
  .addEventListener(
    "keydown",
    function(event) {

      if (
        event.key !==
        "Escape"
      ) {

        return;

      }


      const modal =
        document
          .getElementById(
            "monthPickerModal"
          );


      if (
        modal
        &&
        modal
          .classList
          .contains(
            "active"
          )
      ) {

        closeMonthPicker();

      }

    }
  );


/* =====================================================
   CHANGE MONTH

   ★ 월 변경할 때도 최신 데이터 재조회
===================================================== */

async function changeMonth(
  amount
) {

  viewingMonth =
    new Date(
      viewingMonth
        .getFullYear(),
      viewingMonth
        .getMonth()
      +
      amount,
      1
    );


  await refreshFromServer(
    "달력 업데이트 중...",
    "month"
  );


  renderCalendar();

}


/* =====================================================
   OPEN DATE

   ★ 날짜 누를 때 서버에서 최신 데이터 재조회
===================================================== */

async function openDate(
  year,
  month,
  day
) {
  const requestId = ++navigationSequence;

  selectedDate =
    createDateKey(
      year,
      month,
      day
    );


  const refreshed =
    await refreshFromServer(
      "데이트 정보 불러오는 중...",
      "date"
    );


  if (
    !refreshed || requestId !== navigationSequence
  ) {

    return;

  }


  pushAppHistory(
    "date",
    {
      date:
        selectedDate
    }
  );


  showScreen(
    "dateScreen"
  );


  loadDateScreen();

}


/* =====================================================
   DATE SCREEN
===================================================== */

function loadDateScreen() {

  const data =
    getDateData();


  const [
    year,
    month,
    day
  ] =
    selectedDate
      .split("-");


  const actualDate =
    new Date(
      Number(year),
      Number(month) - 1,
      Number(day)
    );


  const weekdays = [

    "일요일",
    "월요일",
    "화요일",
    "수요일",
    "목요일",
    "금요일",
    "토요일"

  ];


  document
    .getElementById(
      "dateTitle"
    )
    .textContent =

    `${Number(month)}월 `
    +
    `${Number(day)}일 `
    +
    weekdays[
      actualDate
        .getDay()
    ];


  document
    .getElementById(
      "startTime"
    )
    .value =
    data.startTime || "";


  document
    .getElementById(
      "endTime"
    )
    .value =
    data.endTime || "";


  document
    .getElementById(
      "dateMemo"
    )
    .value =
    data.memo || "";


  updateTimeDisplays();

  updateCategoryCounts();
  captureDateFormSnapshot(data);

}


/* =====================================================
   SAVE DATE
===================================================== */

async function saveDateInfo(showMessage = true) {
  if (!selectedDate || !dateFormSnapshot || dateFormSnapshot.dateKey !== selectedDate) return true;
  if (dateSaveInFlight) {
    try { return await dateSaveInFlight; }
    catch (error) { if (!showMessage) throw error; if (!error.keepEditing) alert(error.message); return false; }
  }
  const snapshot = { ...dateFormSnapshot };
  const submittedForm = readDateForm();
  if (sameDateForm(snapshot, submittedForm)) {
    if (showMessage) showSuccessModal("저장 완료", "변경된 내용이 없어요.");
    return true;
  }
  const dateKey = snapshot.dateKey;
  dateSaveInFlight = (async () => {
    if (showMessage) showLoading("데이트 저장 중...");
    try {
      const columnNames = { startTime: "start_time", endTime: "end_time", memo: "memo" };
      const changes = Object.fromEntries(Object.entries(columnNames)
        .filter(([key]) => submittedForm[key] !== snapshot[key])
        .map(([key, column]) => [column, submittedForm[key] || null]));
      let response;
      if (snapshot.id) {
        let query = db.from("dates").update({ ...changes, updated_at: new Date().toISOString() }).eq("id", snapshot.id);
        if (snapshot.updatedAt) query = query.eq("updated_at", snapshot.updatedAt);
        response = await query.select();
      } else if (!submittedForm.startTime && !submittedForm.endTime && !submittedForm.memo) {
        dateFormSnapshot = { ...snapshot, ...submittedForm };
        return true;
      } else {
        response = await db.from("dates").insert({ date: dateKey, ...changes }).select();
      }
      const hasConflict = response.error?.code === "23505" || (!response.error && !response.data?.length);
      let loadedLatest = false;
      if (hasConflict) {
        const latestResponse = await db.from("dates").select("id,date,start_time,end_time,memo,updated_at").eq("date", dateKey).limit(1);
        if (latestResponse.error) throw latestResponse.error;
        const latest = latestResponse.data?.[0];
        const latestForm = dateFormFromRow(latest);
        hideLoading();
        const choice = await askAppChoice("함께 수정한 내용이 있어요", "상대방의 최신 기록을 불러오거나, 내가 수정한 항목만 저장할 수 있어요.\n\n최신 메모: " + (latestForm.memo.slice(0, 240) || "없음") + "\n최신 시간: " + (latestForm.startTime || "미정") + " – " + (latestForm.endTime || "미정"), [
          { value: "latest", label: "최신 내용 불러오기 · 내 입력 바꾸기" },
          { value: "mine", label: "내가 수정한 항목 저장" },
          { value: "cancel", label: "계속 편집하기" }
        ]);
        if (choice === "cancel") { const error = new Error("입력한 내용을 유지했어요."); error.keepEditing = true; throw error; }
        if (choice === "latest") {
          response = { data: [latest || { id: null, date: dateKey, ...{ start_time: null, end_time: null, memo: null } }], error: null };
          loadedLatest = true;
        } else if (choice === "mine") {
          if (showMessage) showLoading("내 수정 내용 저장 중...");
          response = latest
            ? await db.from("dates").update({ ...changes, updated_at: new Date().toISOString() }).eq("id", latest.id).eq("updated_at", latest.updated_at).select()
            : await db.from("dates").insert({ date: dateKey, ...changes }).select();
        } else { const error = new Error("입력한 내용을 유지했어요."); error.keepEditing = true; throw error; }
      }
      if (response.error) throw response.error;
      const row = response.data?.[0];
      if (!row) throw new Error("저장하는 동안 상대방이 다시 수정했어요. 입력은 유지했으니 다시 저장해 주세요.");
      const savedForm = dateFormFromRow(row);
      appData[dateKey] = { ...(appData[dateKey] || createEmptyDate(dateKey)), id: row.id, updatedAt: row.updated_at, ...savedForm };
      if (dateFormSnapshot?.dateKey === dateKey) {
        dateFormSnapshot = { dateKey, id: row.id, updatedAt: row.updated_at, ...savedForm };
        if (selectedDate === dateKey && sameDateForm(readDateForm(), submittedForm)) fillDateForm(savedForm);
      }
      renderCalendar();
      if (showMessage) showSuccessModal(loadedLatest ? "최신 내용을 불러왔어요" : "저장 완료", "");
      return true;
    } catch (error) {
      if (!error.keepEditing) console.error("데이트 저장 실패:", error);
      if (showMessage) { if (!error.keepEditing) alert("데이트 저장 실패\n" + error.message); return false; }
      throw error;
    } finally {
      if (showMessage) hideLoading();
    }
  })();
  try { return await dateSaveInFlight; }
  finally { dateSaveInFlight = null; }
}


/* =====================================================
   ENSURE DATE ROW
===================================================== */

async function ensureDateRow(dateKey = selectedDate) {
  if (!dateKey) throw new Error("먼저 날짜를 선택해 주세요.");
  const cached = appData[dateKey];
  if (cached?.id) return cached.id;
  let response = await db.from("dates").select("id,date,start_time,end_time,memo,updated_at").eq("date", dateKey).limit(1);
  if (response.error) throw response.error;
  let row = response.data?.[0];
  if (!row) {
    response = await db.from("dates").insert({ date: dateKey }).select();
    if (response.error) {
      if (response.error.code !== "23505") throw response.error;
      response = await db.from("dates").select("id,date,start_time,end_time,memo,updated_at").eq("date", dateKey).limit(1);
      if (response.error) throw response.error;
    }
    row = response.data?.[0];
  }
  if (!row) throw new Error("날짜를 준비하지 못했어요. 다시 시도해 주세요.");
  appData[dateKey] = { ...makeDateDataFromRow(row), places: cached?.places || createEmptyDate(dateKey).places };
  return row.id;
}


/* =====================================================
   TIME DISPLAY
===================================================== */

function updateTimeDisplays() {

  updateSingleTimeDisplay(
    "startTime"
  );


  updateSingleTimeDisplay(
    "endTime"
  );

}


function updateSingleTimeDisplay(
  inputId
) {

  const value =
    document
      .getElementById(
        inputId
      )
      .value;


  const displayId =
    inputId === "startTime"
    ?
    "startTimeDisplay"
    :
    "endTimeDisplay";


  const buttonId =
    inputId === "startTime"
    ?
    "startTimeButton"
    :
    "endTimeButton";


  const display =
    document
      .getElementById(
        displayId
      );


  const button =
    document
      .getElementById(
        buttonId
      );


  if (!value) {

    display.textContent =
      "시간 선택";


    button
      .classList
      .remove(
        "has-value"
      );


    return;

  }


  display.textContent =
    convertToPrettyTime(
      value
    );


  button
    .classList
    .add(
      "has-value"
    );

}


function convertToPrettyTime(
  time
) {

  const [
    hourText,
    minute
  ] =
    time.split(":");


  let hour =
    Number(
      hourText
    );


  const period =
    hour >= 12
    ?
    "오후"
    :
    "오전";


  hour =
    hour % 12;


  if (
    hour === 0
  ) {

    hour = 12;

  }


  return (
    `${period} `
    +
    `${hour}:`
    +
    `${minute}`
  );

}


/* =====================================================
   CATEGORY COUNTS
===================================================== */

function updateCategoryCounts() {

  const data =
    getDateData();


  document
    .getElementById(
      "restaurantCount"
    )
    .textContent =
    `후보 ${data.places.restaurant.length}곳`;


  document
    .getElementById(
      "cafeCount"
    )
    .textContent =
    `후보 ${data.places.cafe.length}곳`;


  document
    .getElementById(
      "activityCount"
    )
    .textContent =
    `후보 ${data.places.activity.length}곳`;

}


/* =====================================================
   TIME PICKER
===================================================== */

function initializeTimePicker() {

  const hourSelect =
    document
      .getElementById(
        "timeHour"
      );


  const minuteSelect =
    document
      .getElementById(
        "timeMinute"
      );


  for (
    let hour = 1;
    hour <= 12;
    hour++
  ) {

    const option =
      document
        .createElement(
          "option"
        );


    option.value =
      hour;


    option.textContent =
      String(hour)
        .padStart(
          2,
          "0"
        );


    hourSelect
      .appendChild(
        option
      );

  }


  for (
    let minute = 0;
    minute < 60;
    minute++
  ) {

    const option =
      document
        .createElement(
          "option"
        );


    option.value =
      minute;


    option.textContent =
      String(minute)
        .padStart(
          2,
          "0"
        );


    minuteSelect
      .appendChild(
        option
      );

  }

}


function openTimePicker(
  target
) {

  currentTimeTarget =
    target;


  const existingTime =
    document
      .getElementById(
        target
      )
      .value;


  let hour24;
  let minute;


  if (
    existingTime
  ) {

    [
      hour24,
      minute
    ] =
      existingTime
        .split(":")
        .map(Number);

  } else {

    const now =
      new Date();


    hour24 =
      now.getHours();


    minute =
      now.getMinutes();

  }


  const period =
    hour24 >= 12
    ?
    "PM"
    :
    "AM";


  let hour12 =
    hour24 % 12;


  if (
    hour12 === 0
  ) {

    hour12 = 12;

  }


  document
    .getElementById(
      "timePeriod"
    )
    .value =
    period;


  document
    .getElementById(
      "timeHour"
    )
    .value =
    hour12;


  document
    .getElementById(
      "timeMinute"
    )
    .value =
    minute;


  document
    .getElementById(
      "timePickerModal"
    )
    .classList
    .add(
      "active"
    );

}


function confirmSelectedTime() {

  if (
    !currentTimeTarget
  ) {

    return;

  }


  const period =
    document
      .getElementById(
        "timePeriod"
      )
      .value;


  let hour =
    Number(
      document
        .getElementById(
          "timeHour"
        )
        .value
    );


  const minute =
    Number(
      document
        .getElementById(
          "timeMinute"
        )
        .value
    );


  if (
    period === "AM"
    &&
    hour === 12
  ) {

    hour = 0;

  }


  if (
    period === "PM"
    &&
    hour !== 12
  ) {

    hour += 12;

  }


  const value =
    String(hour)
      .padStart(
        2,
        "0"
      )
    +
    ":"
    +
    String(minute)
      .padStart(
        2,
        "0"
      );


  document
    .getElementById(
      currentTimeTarget
    )
    .value =
    value;


  closeTimePicker();

  updateTimeDisplays();

}


function clearSelectedTime() {

  if (
    !currentTimeTarget
  ) {

    return;

  }


  document
    .getElementById(
      currentTimeTarget
    )
    .value =
    "";


  closeTimePicker();

  updateTimeDisplays();

}


function closeTimePicker() {

  document
    .getElementById(
      "timePickerModal"
    )
    .classList
    .remove(
      "active"
    );


  currentTimeTarget =
    null;

}


document
  .getElementById(
    "timePickerModal"
  )
  .addEventListener(
    "click",
    function(event) {

      if (
        event.target === this
      ) {

        closeTimePicker();

      }

    }
  );


/* =====================================================
   CATEGORY INFO
===================================================== */

const categoryInfo = {

  restaurant: {

    title:
      "음식점 후보",

    button:
      "+ 음식점 후보 추가",

    emptyEmoji:
      "🍽️",

    emptyText:
      "아직 음식점 후보가 없어"

  },


  cafe: {

    title:
      "카페 후보",

    button:
      "+ 카페 후보 추가",

    emptyEmoji:
      "☕",

    emptyText:
      "아직 카페 후보가 없어"

  },


  activity: {

    title:
      "놀 곳 후보",

    button:
      "+ 놀 곳 후보 추가",

    emptyEmoji:
      "🎡",

    emptyText:
      "아직 놀 곳 후보가 없어"

  }

};


/* =====================================================
   OPEN CATEGORY

   ★ 들어갈 때 서버 최신 데이터 재조회
===================================================== */

async function openCategory(
  category
) {
  const requestId = ++navigationSequence;

  try {

    /*
      현재 날짜에서 바꾼 시간/메모 먼저 저장
    */

    await saveDateInfo(
      false
    );


    /*
      ★ 상대방이 추가한 장소까지
      서버에서 최신 정보 다시 받기
    */

    const refreshed =
      await refreshFromServer(
        "후보 불러오는 중...",
        "date"
      );


    if (
      !refreshed || requestId !== navigationSequence
    ) {

      return;

    }


    currentCategory =
      category;


    document
      .getElementById(
        "categoryTitle"
      )
      .textContent =
      categoryInfo[
        category
      ]
      .title;


    document
      .getElementById(
        "addPlaceButton"
      )
      .textContent =
      categoryInfo[
        category
      ]
      .button;


    pushAppHistory("category", { date: selectedDate, category: currentCategory });

    showScreen(
      "categoryScreen"
    );


    renderPlaceList();


  } catch (error) {
    if (error.keepEditing) return;

    console.error(
      error
    );


    alert(
      "후보를 불러오는 중 오류가 발생했어.\n"
      +
      error.message
    );

  }

}


/* =====================================================
   PLACE LIST
===================================================== */

function renderPlaceList() {

  const container =
    document
      .getElementById(
        "placeList"
      );


  const data =
    getDateData();


  const places =
    data.places[
      currentCategory
    ]
    ||
    [];


  container.innerHTML =
    "";


  if (
    places.length === 0
  ) {

    container.innerHTML = `

      <div class="empty-state">

        <div class="emoji">
          ${
            categoryInfo[
              currentCategory
            ]
            .emptyEmoji
          }
        </div>

        <p>
          ${
            categoryInfo[
              currentCategory
            ]
            .emptyText
          }
        </p>

      </div>

    `;


    return;

  }


  places.forEach(
    function(
      place,
      index
    ) {

      const card =
        document
          .createElement(
            "div"
          );


      card.className =
        "place-card";


      const placeImages =
        place.images || [];


      const imageHtml =
        placeImages.length > 0
        ?
        placeImages
          .map(
            function(image) {

              return `
                <div class="place-image-slide">

                  <img
                    src="${escapeHtml(image.url)}"
                    alt="${escapeHtml(place.name)}"
                  >

                </div>
              `;

            }
          )
          .join("")
        :
        `
          <span>
            사진 없음
          </span>
        `;


      card.innerHTML = `

        <div class="place-gallery-shell">

          <div class="place-image ${placeImages.length > 0 ? "" : "empty"}">

            ${imageHtml}

          </div>

          ${
            placeImages.length > 1
            ?
            `
              <div class="place-gallery-counter">
                1 / ${placeImages.length}
              </div>

              <div class="place-gallery-dots">
                ${
                  placeImages
                    .map(
                      (_, dotIndex) =>
                        `<span class="gallery-dot ${dotIndex === 0 ? "active" : ""}"></span>`
                    )
                    .join("")
                }
              </div>
            `
            :
            ""
          }

        </div>


        <div class="place-body">

          <div class="place-title-row">

            <div class="place-title">
              ${
                escapeHtml(
                  place.name
                )
              }
            </div>


            <button
              type="button"
              class="delete-button"
              onclick="deletePlace(${index})"
            >
              ×
            </button>

          </div>


          ${
            place.address
            ?
            `
              <div class="place-address">
                ${
                  escapeHtml(
                    place.address
                  )
                }
              </div>
            `
            :
            ""
          }


          ${
            place.memo
            ?
            `
              <div class="place-memo">
                ${
                  escapeHtml(
                    place.memo
                  )
                }
              </div>
            `
            :
            ""
          }


          <button
            type="button"
            class="edit-button"
            onclick="editPlace(${index})"
          >
            수정
          </button>

        </div>

      `;


      container.appendChild(
        card
      );


      if (
        placeImages.length > 0
      ) {

        setupPlaceCardGallery(
          card,
          placeImages
            .map(
              image =>
                image.url
            )
        );

      }

    }
  );

}



/* =====================================================
   PHOTO GALLERY / FULLSCREEN VIEWER
===================================================== */

function setupPlaceCardGallery(
  card,
  imageUrls
) {

  const gallery =
    card
      .querySelector(
        ".place-image"
      );


  if (
    !gallery
    ||
    imageUrls.length === 0
  ) {

    return;

  }


  const counter =
    card
      .querySelector(
        ".place-gallery-counter"
      );


  const dots =
    Array.from(
      card
        .querySelectorAll(
          ".gallery-dot"
        )
    );


  function updateStatus() {

    const width =
      gallery.clientWidth
      ||
      1;


    const index =
      Math.max(
        0,
        Math.min(
          imageUrls.length - 1,
          Math.round(
            gallery.scrollLeft
            /
            width
          )
        )
      );


    if (
      counter
    ) {

      counter.textContent =
        `${index + 1} / ${imageUrls.length}`;

    }


    dots.forEach(
      function(
        dot,
        dotIndex
      ) {

        dot
          .classList
          .toggle(
            "active",
            dotIndex === index
          );

      }
    );

  }


  gallery.onscroll =
    updateStatus;


  gallery
    .querySelectorAll(
      "img"
    )
    .forEach(
      function(
        img,
        index
      ) {

        img.style.cursor =
          "zoom-in";


        img.addEventListener(
          "click",
          function() {

            openImageViewer(
              imageUrls,
              index
            );

          }
        );

      }
    );


  updateStatus();

}


function openImageViewer(
  images,
  startIndex = 0
) {

  if (
    !images
    ||
    images.length === 0
  ) {

    return;

  }


  imageViewerImages =
    images.filter(
      Boolean
    );


  imageViewerIndex =
    Math.max(
      0,
      Math.min(
        imageViewerImages.length - 1,
        startIndex
      )
    );


  renderImageViewer();


  document
    .getElementById(
      "imageViewer"
    )
    .classList
    .add(
      "active"
    );


  document.body.style.overflow =
    "hidden";

}


function renderImageViewer() {

  if (
    imageViewerImages.length === 0
  ) {

    return;

  }


  document
    .getElementById(
      "imageViewerImage"
    )
    .src =
    imageViewerImages[
      imageViewerIndex
    ];


  document
    .getElementById(
      "imageViewerCounter"
    )
    .textContent =
    `${imageViewerIndex + 1} / ${imageViewerImages.length}`;


  const dots =
    document
      .getElementById(
        "imageViewerDots"
      );


  dots.innerHTML =
    "";


  imageViewerImages
    .forEach(
      function(
        _,
        index
      ) {

        const dot =
          document
            .createElement(
              "span"
            );


        dot.className =
          "image-viewer-dot"
          +
          (
            index ===
            imageViewerIndex
            ?
            " active"
            :
            ""
          );


        dots.appendChild(
          dot
        );

      }
    );

}


function changeImageViewer(
  amount
) {

  if (
    imageViewerImages.length <= 1
  ) {

    return;

  }


  imageViewerIndex =
    (
      imageViewerIndex
      +
      amount
      +
      imageViewerImages.length
    )
    %
    imageViewerImages.length;


  renderImageViewer();

}


function closeImageViewer() {

  document
    .getElementById(
      "imageViewer"
    )
    .classList
    .remove(
      "active"
    );


  document.body.style.overflow =
    "";


  imageViewerImages = [];

}


function handleImageViewerBackground(
  event
) {

  if (
    event.target ===
    event.currentTarget
  ) {

    closeImageViewer();

  }

}


document
  .getElementById(
    "imageViewerStage"
  )
  .addEventListener(
    "touchstart",
    function(event) {

      imageViewerTouchStartX =
        event.touches?.[0]?.clientX
        ??
        null;

    },
    {
      passive: true
    }
  );


document
  .getElementById(
    "imageViewerStage"
  )
  .addEventListener(
    "touchend",
    function(event) {

      if (
        imageViewerTouchStartX ===
        null
      ) {

        return;

      }


      const endX =
        event.changedTouches?.[0]?.clientX;


      if (
        endX ===
        undefined
      ) {

        imageViewerTouchStartX =
          null;

        return;

      }


      const difference =
        endX
        -
        imageViewerTouchStartX;


      if (
        Math.abs(
          difference
        ) > 45
      ) {

        changeImageViewer(
          difference < 0
          ?
          1
          :
          -1
        );

      }


      imageViewerTouchStartX =
        null;

    },
    {
      passive: true
    }
  );


document
  .addEventListener(
    "keydown",
    function(event) {

      const viewer =
        document
          .getElementById(
            "imageViewer"
          );


      if (
        !viewer
          .classList
          .contains(
            "active"
          )
      ) {

        return;

      }


      if (
        event.key ===
        "Escape"
      ) {

        closeImageViewer();

      }


      if (
        event.key ===
        "ArrowLeft"
      ) {

        changeImageViewer(
          -1
        );

      }


      if (
        event.key ===
        "ArrowRight"
      ) {

        changeImageViewer(
          1
        );

      }

    }
  );


/* =====================================================
   KAKAO PLACE SEARCH
===================================================== */

function resetKakaoPlaceSearch() {

  kakaoPlaceResults =
    [];


  document
    .getElementById(
      "kakaoPlaceKeyword"
    )
    .value =
    "";


  document
    .getElementById(
      "kakaoPlaceResults"
    )
    .innerHTML =
    "";


  document
    .getElementById(
      "kakaoPlaceResults"
    )
    .classList
    .remove(
      "active"
    );


  document
    .getElementById(
      "selectedKakaoPlace"
    )
    .classList
    .remove(
      "active"
    );


  document
    .getElementById(
      "selectedKakaoPlaceName"
    )
    .textContent =
    "";


  document
    .getElementById(
      "selectedKakaoPlaceAddress"
    )
    .textContent =
    "";


  hidePreviousPlaceHistory();

}


function clearSelectedKakaoCoordinates() {

  document
    .getElementById(
      "placeLatitude"
    )
    .value =
    "";


  document
    .getElementById(
      "placeLongitude"
    )
    .value =
    "";


  document
    .getElementById(
      "selectedKakaoPlace"
    )
    .classList
    .remove(
      "active"
    );


  hidePreviousPlaceHistory();

}


function handleKakaoSearchKeydown(
  event
) {

  if (
    event.key ===
    "Enter"
  ) {

    event.preventDefault();

    searchKakaoPlaces();

  }

}


function showKakaoSearchMessage(
  message
) {

  const container =
    document
      .getElementById(
        "kakaoPlaceResults"
      );


  container.innerHTML =
    "";


  const messageBox =
    document
      .createElement(
        "div"
      );


  messageBox.className =
    "place-search-message";


  messageBox.textContent =
    message;


  container.appendChild(
    messageBox
  );


  container
    .classList
    .add(
      "active"
    );

}


function searchKakaoPlaces() {

  const keyword =
    document
      .getElementById(
        "kakaoPlaceKeyword"
      )
      .value
      .trim();


  if (!keyword) {

    showKakaoSearchMessage(
      "검색할 장소 이름을 입력해줘."
    );

    return;

  }


  if (
    typeof kakao ===
    "undefined"
    ||
    !kakao.maps
    ||
    !kakao.maps.services
  ) {

    showKakaoSearchMessage(
      "장소 검색에 연결하지 못했어요. 잠시 후 다시 시도하거나 직접 입력해 주세요."
    );

    return;

  }


  showKakaoSearchMessage(
    "검색 중..."
  );


  const placeService =
    new kakao.maps.services.Places();


  placeService
    .keywordSearch(
      keyword,
      function(
        data,
        status
      ) {

        if (
          status ===
          kakao.maps.services.Status.OK
        ) {

          kakaoPlaceResults =
            data || [];


          renderKakaoPlaceResults();

          return;

        }


        kakaoPlaceResults =
          [];


        if (
          status ===
          kakao.maps.services.Status.ZERO_RESULT
        ) {

          showKakaoSearchMessage(
            "검색 결과가 없어."
          );

          return;

        }


        showKakaoSearchMessage(
          "장소 검색 중 오류가 발생했어."
        );

      },
      {
        size:
          15
      }
    );

}


function renderKakaoPlaceResults() {

  const container =
    document
      .getElementById(
        "kakaoPlaceResults"
      );


  container.innerHTML =
    "";


  if (
    kakaoPlaceResults.length ===
    0
  ) {

    showKakaoSearchMessage(
      "검색 결과가 없어."
    );

    return;

  }


  kakaoPlaceResults
    .forEach(
      function(
        place,
        index
      ) {

        const button =
          document
            .createElement(
              "button"
            );


        button.type =
          "button";


        button.className =
          "place-search-result";


        const name =
          document
            .createElement(
              "div"
            );


        name.className =
          "place-search-result-name";


        name.textContent =
          place.place_name
          ||
          "이름 없는 장소";


        const address =
          document
            .createElement(
              "div"
            );


        address.className =
          "place-search-result-address";


        address.textContent =
          place.road_address_name
          ||
          place.address_name
          ||
          "주소 정보 없음";


        button.appendChild(
          name
        );


        button.appendChild(
          address
        );


        if (
          place.category_name
        ) {

          const category =
            document
              .createElement(
                "div"
              );


          category.className =
            "place-search-result-category";


          category.textContent =
            place.category_name;


          button.appendChild(
            category
          );

        }


        button.onclick =
          function() {

            selectKakaoPlace(
              index
            );

          };


        container.appendChild(
          button
        );

      }
    );


  container
    .classList
    .add(
      "active"
    );

}


async function selectKakaoPlace(
  index
) {

  const place =
    kakaoPlaceResults[
      index
    ];


  if (!place) {
    return;
  }


  const address =
    place.road_address_name
    ||
    place.address_name
    ||
    "";


  document
    .getElementById(
      "placeName"
    )
    .value =
    place.place_name
    ||
    "";


  document
    .getElementById(
      "placeAddress"
    )
    .value =
    address;


  document
    .getElementById(
      "placeLatitude"
    )
    .value =
    place.y
    ||
    "";


  document
    .getElementById(
      "placeLongitude"
    )
    .value =
    place.x
    ||
    "";


  document
    .getElementById(
      "selectedKakaoPlaceName"
    )
    .textContent =
    place.place_name
    ||
    "";


  document
    .getElementById(
      "selectedKakaoPlaceAddress"
    )
    .textContent =
    address;


  document
    .getElementById(
      "selectedKakaoPlace"
    )
    .classList
    .add(
      "active"
    );


  document
    .getElementById(
      "kakaoPlaceResults"
    )
    .classList
    .remove(
      "active"
    );


  await loadPreviousPlaceHistory({

    name:
      place.place_name
      ||
      "",

    address:
      address,

    latitude:
      Number(
        place.y
      ),

    longitude:
      Number(
        place.x
      )

  });

}



/* =====================================================
   PREVIOUS PLACE HISTORY
===================================================== */

function hidePreviousPlaceHistory() {

  previousPlaceRecords = [];


  const section =
    document
      .getElementById(
        "previousPlaceSection"
      );


  const list =
    document
      .getElementById(
        "previousPlaceList"
      );


  if (
    section
  ) {

    section
      .classList
      .remove(
        "active"
      );

  }


  if (
    list
  ) {

    list.innerHTML =
      "";

  }

}


function sameCoordinates(
  aLat,
  aLng,
  bLat,
  bLng
) {

  if (
    !Number.isFinite(
      Number(aLat)
    )
    ||
    !Number.isFinite(
      Number(aLng)
    )
    ||
    !Number.isFinite(
      Number(bLat)
    )
    ||
    !Number.isFinite(
      Number(bLng)
    )
  ) {

    return false;

  }


  return (
    Math.abs(
      Number(aLat)
      -
      Number(bLat)
    ) < 0.000001
    &&
    Math.abs(
      Number(aLng)
      -
      Number(bLng)
    ) < 0.000001
  );

}


async function loadPreviousPlaceHistory(
  target
) {

  hidePreviousPlaceHistory();


  if (
    editingPlaceIndex !==
    null
  ) {

    return;

  }


  if (
    !target.name
  ) {

    return;

  }


  try {

    const historyQueries = [];


    if (
      Number.isFinite(
        target.latitude
      )
      &&
      Number.isFinite(
        target.longitude
      )
    ) {

      const tolerance =
        0.000001;


      historyQueries.push(
        db
          .from(
            "places"
          )
          .select("*")
          .gte(
            "latitude",
            target.latitude - tolerance
          )
          .lte(
            "latitude",
            target.latitude + tolerance
          )
          .gte(
            "longitude",
            target.longitude - tolerance
          )
          .lte(
            "longitude",
            target.longitude + tolerance
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          )
          .limit(
            30
          )
      );

    }


    historyQueries.push(
      db
        .from(
          "places"
        )
        .select("*")
        .eq(
          "name",
          target.name
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .limit(
          30
        )
    );


    const historyResponses =
      await Promise.all(
        historyQueries
      );


    const responseError =
      historyResponses
        .find(
          response =>
            response.error
        )
        ?.error;


    const candidatePlaceMap =
      new Map();


    for (
      const response of
      historyResponses
    ) {

      for (
        const place of
        response.data || []
      ) {

        candidatePlaceMap.set(
          place.id,
          place
        );

      }

    }


    const candidatePlaces =
      Array.from(
        candidatePlaceMap.values()
      );


    const placesError =
      responseError;

    if (
      placesError
    ) {

      throw placesError;

    }


    const matchedPlaces =
      (candidatePlaces || [])
        .filter(
          function(place) {

            const coordinateMatch =
              sameCoordinates(
                place.latitude,
                place.longitude,
                target.latitude,
                target.longitude
              );


            const addressMatch =
              Boolean(
                target.address
                &&
                place.address
                &&
                place.address.trim() ===
                target.address.trim()
              );


            return (
              coordinateMatch
              ||
              addressMatch
            );

          }
        );


    if (
      matchedPlaces.length === 0
    ) {

      return;

    }


    const dateIds =
      [
        ...new Set(
          matchedPlaces
            .map(
              place =>
                place.date_id
            )
        )
      ];


    const {
      data: dates,
      error: datesError
    } =
      await db
        .from(
          "dates"
        )
        .select(
          "id,date"
        )
        .in(
          "id",
          dateIds
        );


    if (
      datesError
    ) {

      throw datesError;

    }


    const dateMap = {};


    for (
      const dateRow of
      dates || []
    ) {

      dateMap[
        dateRow.id
      ] =
        dateRow.date;

    }


    const otherPlaces =
      matchedPlaces
        .filter(
          place =>
            dateMap[
              place.date_id
            ]
            !==
            selectedDate
        )
        .slice(
          0,
          8
        );


    if (
      otherPlaces.length === 0
    ) {

      return;

    }


    const placeIds =
      otherPlaces
        .map(
          place =>
            place.id
        );


    const {
      data: images,
      error: imagesError
    } =
      await db
        .from(
          "place_images"
        )
        .select("*")
        .in(
          "place_id",
          placeIds
        )
        .order(
          "created_at",
          {
            ascending: true
          }
        );


    if (
      imagesError
    ) {

      throw imagesError;

    }


    const imageByPlace = {};


    for (
      const image of
      images || []
    ) {

      if (
        !imageByPlace[
          image.place_id
        ]
      ) {

        imageByPlace[
          image.place_id
        ] = [];

      }


      const publicUrlData = { publicUrl: await signedImageUrl(image.storage_path) };


      imageByPlace[
        image.place_id
      ]
      .push({

        id:
          image.id,

        storagePath:
          image.storage_path,



        fileSize:

          Number(

            image.file_size

            ||

            0

          ),

        url:
          publicUrlData.publicUrl

      });

    }


    previousPlaceRecords =
      otherPlaces
        .map(
          place => ({

            ...place,

            date:
              dateMap[
                place.date_id
              ],

            images:
              imageByPlace[
                place.id
              ]
              ||
              []

          })
        )
        .sort(
          (a, b) =>
            String(b.date)
              .localeCompare(
                String(a.date)
              )
        );


    renderPreviousPlaceHistory();


  } catch (error) {

    console.warn(
      "이전 장소 기록 조회 실패:",
      error
    );

  }

}


function formatPreviousDate(
  dateKey
) {

  if (
    !dateKey
  ) {

    return "이전 기록";

  }


  const [
    year,
    month,
    day
  ] =
    dateKey
      .split("-");


  return (
    `${year}.${Number(month)}.${Number(day)}`
  );

}


function renderPreviousPlaceHistory() {

  const section =
    document
      .getElementById(
        "previousPlaceSection"
      );


  const list =
    document
      .getElementById(
        "previousPlaceList"
      );


  list.innerHTML =
    "";


  if (
    previousPlaceRecords.length ===
    0
  ) {

    section
      .classList
      .remove(
        "active"
      );

    return;

  }


  previousPlaceRecords
    .forEach(
      function(
        record,
        index
      ) {

        const card =
          document
            .createElement(
              "div"
            );


        card.className =
          "previous-place-card";


        const info =
          document
            .createElement(
              "div"
            );


        info.className =
          "previous-place-info";


        const date =
          document
            .createElement(
              "div"
            );


        date.className =
          "previous-place-date";


        date.textContent =
          formatPreviousDate(
            record.date
          );


        const summary =
          document
            .createElement(
              "div"
            );


        summary.className =
          "previous-place-summary";


        const details = [];


        if (
          record.memo
        ) {

          details.push(
            record.memo
          );

        }


        if (
          record.images?.length
        ) {

          details.push(
            `사진 ${record.images.length}장`
          );

        }


        summary.textContent =
          details.length > 0
          ?
          details.join(" · ")
          :
          "저장된 장소 정보";


        const button =
          document
            .createElement(
              "button"
            );


        button.type =
          "button";


        button.className =
          "previous-place-import";


        button.textContent =
          "불러오기";


        button.onclick =
          function() {

            importPreviousPlaceRecord(
              index
            );

          };


        info.appendChild(
          date
        );


        info.appendChild(
          summary
        );


        card.appendChild(
          info
        );


        card.appendChild(
          button
        );


        list.appendChild(
          card
        );

      }
    );


  section
    .classList
    .add(
      "active"
    );

}


function importPreviousPlaceRecord(
  index
) {

  const record =
    previousPlaceRecords[
      index
    ];


  if (
    !record
  ) {

    return;

  }


  document
    .getElementById(
      "placeMemo"
    )
    .value =
    record.memo
    ||
    "";


  importedPhotoImages =
    (record.images || [])
      .filter(
        function(image) {

          return !existingPhotoImages
            .some(
              current =>
                current.storagePath ===
                image.storagePath
            );

        }
      )
      .filter(
        function(image, index, array) {

          return array
            .findIndex(
              current =>
                current.storagePath ===
                image.storagePath
            ) === index;

        }
      )
      .map(
        image => ({
          ...image
        })
      );


  renderPhotoPreviewGallery();

}


/* =====================================================
   PLACE MODAL
===================================================== */

function openPlaceModal() {

  if (placeSaveInFlight) return;
  placeEditorId = newRecordId();
  placeEditorPersisted = false;
  placeEditorDate = selectedDate;
  placeEditorCategory = currentCategory;

  editingPlaceIndex =
    null;


  resetPhotoEditorState();


  resetKakaoPlaceSearch();


  document
    .getElementById(
      "placeLatitude"
    )
    .value =
    "";


  document
    .getElementById(
      "placeLongitude"
    )
    .value =
    "";


  document
    .getElementById(
      "modalTitle"
    )
    .textContent =
    "후보 추가";


  document
    .getElementById(
      "placeName"
    )
    .value =
    "";


  document
    .getElementById(
      "placeAddress"
    )
    .value =
    "";


  document
    .getElementById(
      "placeMemo"
    )
    .value =
    "";


  document
    .getElementById(
      "placeImage"
    )
    .value =
    "";



  document
    .getElementById(
      "placeModal"
    )
    .classList
    .add(
      "active"
    );

}


function editPlace(
  index
) {

  if (placeSaveInFlight) return;
  const data =
    getDateData();


  const place =
    data.places[
      currentCategory
    ][index];


  if (!place) return;
  placeEditorId = place.id;
  placeEditorPersisted = true;
  placeEditorDate = selectedDate;
  placeEditorCategory = currentCategory;

  editingPlaceIndex =
    index;


  resetPhotoEditorState();


  existingPhotoImages =
    [
      ...(
        place.images
        ||
        []
      )
    ];


  renderPhotoPreviewGallery();


  resetKakaoPlaceSearch();


  document
    .getElementById(
      "kakaoPlaceKeyword"
    )
    .value =
    place.name || "";


  document
    .getElementById(
      "placeLatitude"
    )
    .value =
    place.latitude ?? "";


  document
    .getElementById(
      "placeLongitude"
    )
    .value =
    place.longitude ?? "";


  if (
    place.latitude !== null
    &&
    place.latitude !== undefined
    &&
    place.longitude !== null
    &&
    place.longitude !== undefined
  ) {

    document
      .getElementById(
        "selectedKakaoPlaceName"
      )
      .textContent =
      place.name || "";


    document
      .getElementById(
        "selectedKakaoPlaceAddress"
      )
      .textContent =
      place.address || "";


    document
      .getElementById(
        "selectedKakaoPlace"
      )
      .classList
      .add(
        "active"
      );

  }


  document
    .getElementById(
      "modalTitle"
    )
    .textContent =
    "후보 수정";


  document
    .getElementById(
      "placeName"
    )
    .value =
    place.name || "";


  document
    .getElementById(
      "placeAddress"
    )
    .value =
    place.address || "";


  document
    .getElementById(
      "placeMemo"
    )
    .value =
    place.memo || "";


  document
    .getElementById(
      "placeImage"
    )
    .value =
    "";


  document
    .getElementById(
      "placeModal"
    )
    .classList
    .add(
      "active"
    );

}


function closePlaceModal(force = false) {
  if (placeSaveInFlight) return;
  if (!force && placeFormSignature() !== placeEditorBaseline && !confirm("아직 저장하지 않은 내용이 있어요. 입력을 버리고 닫을까요?")) return;

  document
    .getElementById(
      "placeModal"
    )
    .classList
    .remove(
      "active"
    );


  resetPhotoEditorState();

}


document
  .getElementById(
    "placeModal"
  )
  .addEventListener(
    "click",
    function(event) {

      if (
        event.target === this
      ) {

        closePlaceModal();

      }

    }
  );


/* =====================================================
   PHOTO
===================================================== */

function resetPhotoEditorState() {

  for (
    const item of
    pendingPhotoFiles
  ) {

    if (
      item.previewUrl
    ) {

      URL.revokeObjectURL(
        item.previewUrl
      );

    }

  }


  pendingPhotoFiles =
    [];


  existingPhotoImages =
    [];


  importedPhotoImages =
    [];


  removedExistingPhotos =
    [];


  const input =
    document
      .getElementById(
        "placeImage"
      );


  if (input) {

    input.value =
      "";

  }


  renderPhotoPreviewGallery();

}


function previewPlaceImages(
  event
) {

  const files =
    Array.from(
      event.target.files
      ||
      []
    );


  if (
    files.length ===
    0
  ) {

    return;

  }


  let invalidFound =
    false;


  for (
    const file of
    files
  ) {

    if (
      !/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(file.type)
      || file.size > 30 * 1024 * 1024
      || existingPhotoImages.length + importedPhotoImages.length + pendingPhotoFiles.length >= 30
    ) {

      invalidFound =
        true;

      continue;

    }


    pendingPhotoFiles
      .push({

        id:
          (
            typeof crypto !==
            "undefined"
            &&
            crypto.randomUUID
          )
          ?
          crypto.randomUUID()
          :
          (
            Date.now()
            +
            "-"
            +
            Math.random()
              .toString(36)
              .slice(2)
          ),

        file:
          file,

        previewUrl:
          URL.createObjectURL(
            file
          )

      });

  }


  event.target.value =
    "";


  if (
    invalidFound
  ) {

    alert(
      "사진은 한 장당 30 MB 이하, 장소당 30장까지 선택할 수 있어요. JPG, PNG, WebP, GIF 또는 HEIC 사진을 사용해 주세요."
    );

  }


  renderPhotoPreviewGallery();

}


function renderPhotoPreviewGallery() {

  const wrapper =
    document
      .getElementById(
        "imagePreviewWrapper"
      );


  const gallery =
    document
      .getElementById(
        "imagePreviewGallery"
      );


  if (
    !wrapper
    ||
    !gallery
  ) {

    return;

  }


  gallery.innerHTML =
    "";


  const totalCount =
    existingPhotoImages.length
    +
    importedPhotoImages.length
    +
    pendingPhotoFiles.length;


  if (
    totalCount ===
    0
  ) {

    wrapper
      .classList
      .remove(
        "active"
      );


    return;

  }


  wrapper
    .classList
    .add(
      "active"
    );


  existingPhotoImages.forEach(
    function(
      image
    ) {

      const slide =
        document
          .createElement(
            "div"
          );


      slide.className =
        "image-preview-slide";


      const img =
        document
          .createElement(
            "img"
          );


      img.src =
        image.url;


      img.alt =
        "사진";


      const deleteButton =
        document
          .createElement(
            "button"
          );


      deleteButton.type =
        "button";


      deleteButton.className =
        "photo-delete-button";


      deleteButton.textContent =
        "×";


      deleteButton.addEventListener(
        "click",
        function() {

          removeExistingPhoto(
            image.id
          );

        }
      );


      slide.appendChild(
        img
      );


      slide.appendChild(
        deleteButton
      );


      gallery.appendChild(
        slide
      );

    }
  );


  importedPhotoImages.forEach(
    function(
      image,
      importedIndex
    ) {

      const slide =
        document
          .createElement(
            "div"
          );


      slide.className =
        "image-preview-slide";


      const img =
        document
          .createElement(
            "img"
          );


      img.src =
        image.url;


      img.alt =
        "이전 사진";


      const deleteButton =
        document
          .createElement(
            "button"
          );


      deleteButton.type =
        "button";


      deleteButton.className =
        "photo-delete-button";


      deleteButton.textContent =
        "×";


      deleteButton.addEventListener(
        "click",
        function() {

          removeImportedPhoto(
            importedIndex
          );

        }
      );


      slide.appendChild(
        img
      );


      slide.appendChild(
        deleteButton
      );


      gallery.appendChild(
        slide
      );

    }
  );


  pendingPhotoFiles.forEach(
    function(
      item
    ) {

      const slide =
        document
          .createElement(
            "div"
          );


      slide.className =
        "image-preview-slide";


      const img =
        document
          .createElement(
            "img"
          );


      img.src =
        item.previewUrl;


      img.alt =
        "새 사진";


      const deleteButton =
        document
          .createElement(
            "button"
          );


      deleteButton.type =
        "button";


      deleteButton.className =
        "photo-delete-button";


      deleteButton.textContent =
        "×";


      deleteButton.addEventListener(
        "click",
        function() {

          removePendingPhoto(
            item.id
          );

        }
      );


      slide.appendChild(
        img
      );


      slide.appendChild(
        deleteButton
      );


      gallery.appendChild(
        slide
      );

    }
  );


  setupPreviewGalleryStatus();

}


function removeExistingPhoto(
  imageId
) {

  const index =
    existingPhotoImages
      .findIndex(
        image =>
          image.id ===
          imageId
      );


  if (
    index ===
    -1
  ) {

    return;

  }


  const [
    removed
  ] =
    existingPhotoImages
      .splice(
        index,
        1
      );


  removedExistingPhotos
    .push(
      removed
    );


  renderPhotoPreviewGallery();

}


function removeImportedPhoto(
  index
) {

  if (
    index < 0
    ||
    index >=
    importedPhotoImages.length
  ) {

    return;

  }


  importedPhotoImages
    .splice(
      index,
      1
    );


  renderPhotoPreviewGallery();

}


function getPhotoEditorUrls() {

  return [

    ...existingPhotoImages
      .map(
        image =>
          image.url
      ),

    ...importedPhotoImages
      .map(
        image =>
          image.url
      ),

    ...pendingPhotoFiles
      .map(
        item =>
          item.previewUrl
      )

  ]
  .filter(
    Boolean
  );

}


function setupPreviewGalleryStatus() {

  const gallery =
    document
      .getElementById(
        "imagePreviewGallery"
      );


  const counter =
    document
      .getElementById(
        "imagePreviewCounter"
      );


  const dots =
    document
      .getElementById(
        "imagePreviewDots"
      );


  const urls =
    getPhotoEditorUrls();


  dots.innerHTML =
    "";


  if (
    urls.length === 0
  ) {

    counter.textContent =
      "";

    return;

  }


  urls.forEach(
    function(
      _,
      index
    ) {

      const dot =
        document
          .createElement(
            "span"
          );


      dot.className =
        "image-preview-dot"
        +
        (
          index === 0
          ?
          " active"
          :
          ""
        );


      dots.appendChild(
        dot
      );

    }
  );


  function update() {

    const width =
      gallery.clientWidth
      ||
      1;


    const index =
      Math.max(
        0,
        Math.min(
          urls.length - 1,
          Math.round(
            gallery.scrollLeft
            /
            width
          )
        )
      );


    counter.textContent =
      `${index + 1} / ${urls.length}`;


    Array.from(
      dots.children
    )
    .forEach(
      function(
        dot,
        dotIndex
      ) {

        dot
          .classList
          .toggle(
            "active",
            dotIndex === index
          );

      }
    );

  }


  gallery.onscroll =
    update;


  gallery
    .querySelectorAll(
      "img"
    )
    .forEach(
      function(
        img,
        index
      ) {

        img.style.cursor =
          "zoom-in";


        img.onclick =
          function() {

            openImageViewer(
              urls,
              index
            );

          };

      }
    );


  update();

}


function removePendingPhoto(
  itemId
) {

  const index =
    pendingPhotoFiles
      .findIndex(
        item =>
          item.id ===
          itemId
      );


  if (
    index ===
    -1
  ) {

    return;

  }


  const [
    removed
  ] =
    pendingPhotoFiles
      .splice(
        index,
        1
      );


  if (
    removed.previewUrl
  ) {

    URL.revokeObjectURL(
      removed.previewUrl
    );

  }


  renderPhotoPreviewGallery();

}


/* =====================================================
   CLIENT-SIDE PHOTO COMPRESSION
===================================================== */

async function loadImageSourceForCompression(
  file
) {

  if (
    typeof createImageBitmap ===
    "function"
  ) {

    try {

      const bitmap =
        await createImageBitmap(
          file
        );


      return {

        source:
          bitmap,

        width:
          bitmap.width,

        height:
          bitmap.height,

        cleanup:
          function() {

            if (
              bitmap.close
            ) {

              bitmap.close();

            }

          }

      };


    } catch (error) {

      console.warn(
        "createImageBitmap 압축 준비 실패:",
        error
      );

    }

  }


  return await new Promise(
    function(
      resolve,
      reject
    ) {

      const objectUrl =
        URL.createObjectURL(
          file
        );


      const image =
        new Image();


      image.onload =
        function() {

          resolve({

            source:
              image,

            width:
              image.naturalWidth,

            height:
              image.naturalHeight,

            cleanup:
              function() {

                URL.revokeObjectURL(
                  objectUrl
                );

              }

          });

        };


      image.onerror =
        function() {

          URL.revokeObjectURL(
            objectUrl
          );


          reject(
            new Error(
              "브라우저에서 사진을 읽지 못했어."
            )
          );

        };


      image.src =
        objectUrl;

    }
  );

}


function canvasToBlob(
  canvas,
  type,
  quality
) {

  return new Promise(
    resolve =>
      canvas.toBlob(
        resolve,
        type,
        quality
      )
  );

}


async function compressImageFile(
  file
) {

  if (
    !file
    ||
    !file.type
      .startsWith(
        "image/"
      )
    ||
    file.type ===
    "image/gif"
    ||
    file.type ===
    "image/svg+xml"
  ) {

    return file;

  }


  let decoded = null;


  try {

    decoded =
      await loadImageSourceForCompression(
        file
      );


    let width =
      decoded.width;


    let height =
      decoded.height;


    if (
      !width
      ||
      !height
    ) {

      return file;

    }


    const initialScale =
      Math.min(
        1,
        PHOTO_MAX_DIMENSION
        /
        Math.max(
          width,
          height
        )
      );


    width =
      Math.max(
        1,
        Math.round(
          width
          *
          initialScale
        )
      );


    height =
      Math.max(
        1,
        Math.round(
          height
          *
          initialScale
        )
      );


    let quality =
      0.82;


    let resultBlob =
      null;


    for (
      let attempt = 0;
      attempt < 6;
      attempt++
    ) {

      const canvas =
        document
          .createElement(
            "canvas"
          );


      canvas.width =
        width;


      canvas.height =
        height;


      const context =
        canvas
          .getContext(
            "2d"
          );


      if (
        !context
      ) {

        return file;

      }


      context.drawImage(
        decoded.source,
        0,
        0,
        width,
        height
      );


      resultBlob =
        await canvasToBlob(
          canvas,
          "image/webp",
          quality
        );


      if (
        !resultBlob
      ) {

        resultBlob =
          await canvasToBlob(
            canvas,
            "image/jpeg",
            quality
          );

      }


      if (
        !resultBlob
      ) {

        return file;

      }


      if (
        resultBlob.size <=
        PHOTO_TARGET_BYTES
      ) {

        break;

      }


      if (
        quality > 0.62
      ) {

        quality =
          Math.max(
            0.62,
            quality - 0.08
          );

      } else {

        width =
          Math.max(
            1,
            Math.round(
              width * 0.85
            )
          );


        height =
          Math.max(
            1,
            Math.round(
              height * 0.85
            )
          );

      }

    }


    if (
      !resultBlob
    ) {

      return file;

    }


    if (
      resultBlob.size >=
      file.size
      &&
      file.size <=
      PHOTO_TARGET_BYTES
    ) {

      return file;

    }


    const baseName =
      file.name
        .replace(
          /\.[^.]+$/,
          ""
        )
      ||
      "photo";


    const outputType =
      resultBlob.type
      ||
      "image/webp";


    const extension =
      outputType ===
      "image/jpeg"
      ?
      "jpg"
      :
      "webp";


    return new File(
      [
        resultBlob
      ],
      `${baseName}.${extension}`,
      {
        type:
          outputType,

        lastModified:
          Date.now()
      }
    );


  } catch (error) {

    console.warn(
      "사진 압축 실패, 원본으로 업로드:",
      error
    );


    return file;


  } finally {

    if (
      decoded?.cleanup
    ) {

      decoded.cleanup();

    }

  }

}


/* =====================================================
   STORAGE PATH
===================================================== */

function makeStoragePath(
  placeId,
  file
) {

  let extension =
    file.name
      .split(".")
      .pop()
      ?.toLowerCase();


  if (
    !extension
    ||
    extension.length > 10
  ) {

    extension =
      "jpg";

  }


  const uniqueId =
    (
      typeof crypto !==
      "undefined"
      &&
      crypto.randomUUID
    )
    ?
    crypto.randomUUID()
    :
    (
      Date.now()
      +
      "-"
      +
      Math.random()
        .toString(36)
        .slice(2)
    );


  return (
    `places/${placeId}/`
    +
    `${uniqueId}.${extension}`
  );

}


/* =====================================================
   IMAGE UPLOAD
===================================================== */

async function uploadPlaceImage(placeId, file, progress = {}) {
  if (!progress.uploadFile) progress.uploadFile = await compressImageFile(file);
  const uploadFile = progress.uploadFile;
  if (!/^image\/(jpeg|png|webp|gif)$/.test(uploadFile.type)) throw new Error("JPG, PNG, WebP, GIF 사진을 사용해 주세요.");
  if (uploadFile.size > 10 * 1024 * 1024) throw new Error("압축 후 사진은 10 MB 이하여야 해요.");
  if (!progress.storagePath) progress.storagePath = makeStoragePath(placeId, uploadFile);
  const storagePath = progress.storagePath;
  if (!progress.storageUploaded) {
    const { error } = await db.storage.from("place-images").upload(storagePath, uploadFile, {
      cacheControl: "3600", contentType: uploadFile.type, upsert: false
    });
    if (error && String(error.statusCode || error.status) !== "409" && !/already exists|duplicate/i.test(error.message || "")) throw error;
    progress.storageUploaded = true;
  }
  if (!progress.imageId) progress.imageId = newRecordId();
  if (!progress.imageRow) {
    let response = await db.from("place_images").insert({
      id: progress.imageId, place_id: placeId, storage_path: storagePath, file_size: uploadFile.size
    }).select().single();
    if (response.error?.code === "23505") response = await db.from("place_images").select("*").eq("id", progress.imageId).single();
    if (response.error) throw response.error;
    if (!response.data) throw new Error("사진 정보를 저장하지 못했어요.");
    progress.imageRow = response.data;
  }
  const url = await signedImageUrl(storagePath);
  if (!progress.usageAdjusted) {
    await adjustStorageUsageDelta(uploadFile.size, 1);
    progress.usageAdjusted = true;
  }
  return { id: progress.imageRow.id, storagePath, fileSize: uploadFile.size, url };
}


/* =====================================================
   DELETE IMAGE
===================================================== */

async function removeStorageObjectIfUnused(
  storagePath,
  fileSize = 0
) {

  if (
    !storagePath
  ) {

    return;

  }


  const {
    data: remainingRows,
    error: referenceError
  } =
    await db
      .from(
        "place_images"
      )
      .select(
        "id"
      )
      .eq(
        "storage_path",
        storagePath
      )
      .limit(
        1
      );


  if (
    referenceError
  ) {

    console.warn(
      "사진 참조 확인 실패:",
      referenceError
    );

    return;

  }


  if (
    remainingRows?.length
  ) {

    return;

  }


  const {
    error: storageError
  } =
    await db
      .storage
      .from(
        "place-images"
      )
      .remove([
        storagePath
      ]);


  if (
    storageError
  ) {

    console.warn(
      "Storage 이미지 삭제 실패:",
      storageError
    );


    return;

  }


  await adjustStorageUsageDelta(
    -Math.max(
      0,
      Number(
        fileSize
        ||
        0
      )
    ),
    -1
  );

}


async function deleteImageObject(
  image
) {

  if (
    !image
  ) {

    return;

  }


  const {
    error: dbError
  } =
    await db
      .from(
        "place_images"
      )
      .delete()
      .eq(
        "id",
        image.id
      );


  if (
    dbError
  ) {

    throw dbError;

  }


  await removeStorageObjectIfUnused(
    image.storagePath,
    image.fileSize
  );

}


/* =====================================================
   SAVE PLACE
===================================================== */

async function savePlace() {
  if (placeSaveInFlight) return;
  const name = document.getElementById("placeName").value.trim();
  if (!name) { alert("장소 이름을 입력해 주세요."); return; }
  const address = document.getElementById("placeAddress").value.trim();
  const memo = document.getElementById("placeMemo").value.trim();
  const latitudeText = document.getElementById("placeLatitude").value.trim();
  const longitudeText = document.getElementById("placeLongitude").value.trim();
  const latitude = latitudeText ? Number(latitudeText) : null;
  const longitude = longitudeText ? Number(longitudeText) : null;
  if ((latitude === null) !== (longitude === null) ||
      (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
       !Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
    alert("지도에서 장소를 다시 선택해 주세요. 좌표가 올바르지 않아요."); return;
  }
  if (name.length > 200 || address.length > 1000 || memo.length > 10000) {
    alert("이름은 200자, 주소는 1,000자, 메모는 10,000자까지 입력할 수 있어요."); return;
  }
  const dateKey = placeEditorDate || selectedDate;
  const category = placeEditorCategory || currentCategory;
  if (!categoryInfo[category]) return;
  if (!placeEditorId) placeEditorId = newRecordId();
  const placeId = placeEditorId;
  const saveButton = document.getElementById("savePlaceButton");
  placeSaveInFlight = true;
  saveButton.disabled = true;
  showLoading("후보 저장 중...");
  try {
    const dateId = await ensureDateRow(dateKey);
    const values = { name, address: address || null, memo: memo || null, latitude, longitude };
    let response;
    if (!placeEditorPersisted) {
      response = await db.from("places").insert({ id: placeId, date_id: dateId, category, ...values }).select().single();
      if (response.error?.code === "23505") {
        response = await db.from("places").update(values).eq("id", placeId).select().single();
      }
    } else {
      response = await db.from("places").update(values).eq("id", placeId).select().single();
    }
    if (response.error) throw response.error;
    if (!response.data) throw new Error("후보가 삭제되었거나 저장 권한이 없어요.");
    placeEditorPersisted = true;
    // Completed attachments leave the pending queue before the next operation.
    while (pendingPhotoFiles.length) {
      const item = pendingPhotoFiles[0];
      const uploaded = await uploadPlaceImage(placeId, item.file, item);
      existingPhotoImages.push(uploaded);
      pendingPhotoFiles.shift();
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    while (importedPhotoImages.length) {
      const image = importedPhotoImages[0];
      if (!image.newAttachmentId) image.newAttachmentId = newRecordId();
      let result = await db.from("place_images").insert({ id: image.newAttachmentId, place_id: placeId,
        storage_path: image.storagePath, file_size: Number(image.fileSize || 0) }).select().single();
      if (result.error?.code === "23505") result = await db.from("place_images").select("*").eq("id", image.newAttachmentId).single();
      if (result.error) throw result.error;
      existingPhotoImages.push({ ...image, id: image.newAttachmentId });
      importedPhotoImages.shift();
    }
    while (removedExistingPhotos.length) {
      await deleteImageObject(removedExistingPhotos[0]);
      removedExistingPhotos.shift();
    }
    await loadSelectedDateData(dateKey);
    placeSaveInFlight = false;
    closePlaceModal(true);
    if (selectedDate === dateKey && currentCategory === category) { renderPlaceList(); updateCategoryCounts(); }
    renderCalendar();
    showSuccessModal("저장 완료", "");
    refreshStorageUsage();
  } catch (error) {
    console.error("장소 저장 실패:", error);
    renderPhotoPreviewGallery();
    alert("저장을 마치지 못했어요. 이미 저장된 내용은 유지되며 다시 저장하면 이어서 처리해요.\n" + error.message);
  } finally {
    placeSaveInFlight = false;
    saveButton.disabled = false;
    hideLoading();
  }
}


/* =====================================================
   DELETE PLACE POPUP
===================================================== */

function deletePlace(
  index
) {

  pendingDeleteIndex =
    index;


  document
    .getElementById(
      "deleteOverlay"
    )
    .classList
    .add(
      "active"
    );

}


function closeDeleteModal() {

  document
    .getElementById(
      "deleteOverlay"
    )
    .classList
    .remove(
      "active"
    );


  pendingDeleteIndex =
    null;

}


document
  .getElementById(
    "deleteOverlay"
  )
  .addEventListener(
    "click",
    function(event) {

      if (
        event.target === this
      ) {

        closeDeleteModal();

      }

    }
  );


/* =====================================================
   CONFIRM DELETE
===================================================== */

async function confirmDeletePlace() {
  if (deletePlaceInFlight || placeSaveInFlight) return;
  const dateKey = selectedDate;

  if (
    pendingDeleteIndex ===
    null
  ) {

    return;

  }


  const index =
    pendingDeleteIndex;


  document
    .getElementById(
      "deleteOverlay"
    )
    .classList
    .remove(
      "active"
    );


  trackModalClose("deleteOverlay");

  pendingDeleteIndex =
    null;


  const place =
    getDateData()
      .places[
        currentCategory
      ][index];


  if (!place) {
    return;
  }


  deletePlaceInFlight = true;
  showLoading(
    "삭제 중..."
  );


  try {

    const storageObjects =
      [];


    const seenStoragePaths =
      new Set();


    for (
      const image of
      place.images || []
    ) {

      if (
        !image.storagePath
        ||
        seenStoragePaths.has(
          image.storagePath
        )
      ) {

        continue;

      }


      seenStoragePaths.add(
        image.storagePath
      );


      storageObjects.push({

        storagePath:
          image.storagePath,

        fileSize:
          Number(
            image.fileSize
            ||
            0
          )

      });

    }


    /*
      장소를 먼저 삭제한다.
      place_images 행은 FK cascade로 지워지고,
      이후 다른 날짜에서 같은 사진을 참조 중인지 확인한다.
    */

    const {
      error
    } =
      await db
        .from(
          "places"
        )
        .delete()
        .eq(
          "id",
          place.id
        );


    if (
      error
    ) {

      throw error;

    }


    for (
      const storageObject of
      storageObjects
    ) {

      await removeStorageObjectIfUnused(
        storageObject.storagePath,
        storageObject.fileSize
      );

    }


    /*
      ★ 삭제 후 서버 최신 데이터 재조회
    */

    await loadSelectedDateData(dateKey);


    renderPlaceList();

    updateCategoryCounts();

    renderCalendar();


    showSuccessModal(
      "삭제 완료",
      "후보가 삭제됐어."
    );


    refreshStorageUsage();


  } catch (error) {

    console.error(
      "삭제 실패:",
      error
    );


    alert(
      "후보 삭제 실패\n"
      +
      error.message
    );


  } finally {
    deletePlaceInFlight = false;

    hideLoading();

  }

}



/* =====================================================
   STORAGE USAGE

   - 평소: 캐시 한 행만 읽기
   - 업로드/실제 파일 삭제: delta만 반영
   - 매시간: Supabase Cron이 실제 Storage 전체값으로 보정
   - 버튼: 즉시 실제값 강제 보정
===================================================== */

function formatStorageBytes(
  bytes
) {

  const value =
    Number(bytes)
    ||
    0;


  if (
    value < 1024
  ) {

    return `${value} B`;

  }


  if (
    value < 1024 * 1024
  ) {

    return `${(value / 1024).toFixed(1)} KB`;

  }


  if (
    value < 1024 * 1024 * 1024
  ) {

    return `${(value / 1024 / 1024).toFixed(1)} MB`;

  }


  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;

}


function normalizeStorageUsageRpcRow(
  data
) {

  if (
    Array.isArray(
      data
    )
  ) {

    return data[0]
      ||
      null;

  }


  return data
    ||
    null;

}


function renderStorageUsage(
  usage
) {

  const card = document.getElementById("storageUsageCard");
  const valueElement = document.getElementById("storageUsageValue");
  const fillElement = document.getElementById("storageUsageFill");
  const countElement = document.getElementById("storagePhotoCount");

  if (!card || !valueElement || !fillElement || !countElement || !usage) {
    return;
  }

  const totalBytes = Math.max(0, Number(usage.total_bytes ?? usage.totalBytes ?? 0));
  const photoCount = Math.max(0, Number(usage.photo_count ?? usage.photoCount ?? 0));
  const percent = FREE_STORAGE_LIMIT_BYTES > 0
    ? totalBytes / FREE_STORAGE_LIMIT_BYTES * 100
    : 0;

  valueElement.textContent = `${formatStorageBytes(totalBytes)} / 1 GB`;
  fillElement.style.width = `${Math.min(100, percent).toFixed(2)}%`;
  countElement.textContent = `사진 ${photoCount}장 · ${percent.toFixed(1)}% 사용`;

  card.classList.toggle("warning", percent >= 70 && percent < 85);
  card.classList.toggle("danger", percent >= 85);
}


async function getCachedStorageUsage() {
  const { data, error } = await db.rpc(
    "get_storage_usage_cache",
    { p_bucket_id: "place-images" }
  );

  if (error) throw error;
  return normalizeStorageUsageRpcRow(data);
}


async function reconcileStorageUsage() {
  const { data, error } = await db.rpc(
    "reconcile_storage_usage",
    { p_bucket_id: "place-images" }
  );

  if (error) throw error;
  return normalizeStorageUsageRpcRow(data);
}


async function adjustStorageUsageDelta(
  deltaBytes,
  deltaCount
) {
  try {
    const { data, error } = await db.rpc(
      "adjust_storage_usage",
      {
        p_bucket_id: "place-images",
        p_delta_bytes: Math.trunc(Number(deltaBytes || 0)),
        p_delta_count: Math.trunc(Number(deltaCount || 0))
      }
    );

    if (error) throw error;

    const usage = normalizeStorageUsageRpcRow(data);
    if (usage) renderStorageUsage(usage);
    return usage;
  } catch (error) {
    console.warn("저장공간 delta 반영 실패:", error);
    return null;
  }
}


async function refreshStorageUsage(
  forceActual = false
) {
  const valueElement = document.getElementById("storageUsageValue");
  const countElement = document.getElementById("storagePhotoCount");

  if (!valueElement || !countElement) return;

  valueElement.textContent = forceActual ? "실제값 확인 중..." : "불러오는 중...";

  try {
    const usage = forceActual
      ? await reconcileStorageUsage()
      : await getCachedStorageUsage();

    if (!usage) throw new Error("저장공간 정보가 없어.");
    renderStorageUsage(usage);
  } catch (error) {
    console.warn("저장공간 사용량 조회 실패:", error);
    valueElement.textContent = "확인 실패";
    countElement.textContent = "인터넷 연결 후 다시 확인해 주세요.";
  }
}


function startStorageUsagePolling() {
  if (storageUsagePollTimer) {
    clearInterval(storageUsagePollTimer);
  }

  storageUsagePollTimer = setInterval(
    function() {
      refreshStorageUsage(false);
    },
    STORAGE_USAGE_POLL_INTERVAL_MS
  );
}


/* =====================================================
   DATE MAP
===================================================== */

function getAllPlacesForSelectedDate() {

  const data =
    getDateData();


  const places = [];


  [
    "restaurant",
    "cafe",
    "activity"
  ]
  .forEach(
    category => {

      (
        data.places[category]
        ||
        []
      )
      .forEach(
        place => {

          places.push({
            ...place,
            category:
              category
          });

        }
      );

    }
  );


  return places;

}


function hasPlaceCoordinates(
  place
) {

  if (
    place.latitude === null
    ||
    place.latitude === undefined
    ||
    place.latitude === ""
    ||
    place.longitude === null
    ||
    place.longitude === undefined
    ||
    place.longitude === ""
  ) {

    return false;

  }


  return (
    Number.isFinite(
      Number(
        place.latitude
      )
    )
    &&
    Number.isFinite(
      Number(
        place.longitude
      )
    )
  );

}



const dateMapMarkerImageCache = {};


function getDateMapCategoryClass(
  category
) {

  if (
    category ===
    "restaurant"
  ) {

    return "restaurant";

  }


  if (
    category ===
    "cafe"
  ) {

    return "cafe";

  }


  return "activity";

}


function getDateMapCategoryColor(
  category
) {

  if (
    category ===
    "restaurant"
  ) {

    return "#e53935";

  }


  if (
    category ===
    "cafe"
  ) {

    return "#1976d2";

  }


  return "#2e9d50";

}


function getDateMapMarkerImage(
  category
) {

  const categoryClass =
    getDateMapCategoryClass(
      category
    );


  if (
    dateMapMarkerImageCache[
      categoryClass
    ]
  ) {

    return dateMapMarkerImageCache[
      categoryClass
    ];

  }


  const color =
    getDateMapCategoryColor(
      category
    );


  const svg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="42"
      viewBox="0 0 32 42"
    >
      <path
        d="M16 1C7.72 1 1 7.72 1 16c0 10.8 15 25 15 25s15-14.2 15-25C31 7.72 24.28 1 16 1z"
        fill="${color}"
        stroke="#ffffff"
        stroke-width="2"
      />
      <circle
        cx="16"
        cy="15.5"
        r="5.2"
        fill="#ffffff"
      />
    </svg>
  `;


  const imageUrl =
    "data:image/svg+xml;charset=UTF-8,"
    +
    encodeURIComponent(
      svg
    );


  const markerImage =
    new kakao.maps.MarkerImage(
      imageUrl,
      new kakao.maps.Size(
        32,
        42
      ),
      {
        offset:
          new kakao.maps.Point(
            16,
            42
          )
      }
    );


  dateMapMarkerImageCache[
    categoryClass
  ] =
    markerImage;


  return markerImage;

}


function createDateMapNameOverlay(
  place,
  position
) {

  const label =
    document
      .createElement(
        "div"
      );


  label.className =
    "date-map-name-label "
    +
    getDateMapCategoryClass(
      place.category
    );


  label.textContent =
    place.name;


  return new kakao.maps.CustomOverlay({
    map:
      dateMap,

    position:
      position,

    content:
      label,

    xAnchor:
      0.5,

    /*
      같은 좌표의 마커보다 위쪽에
      이름표가 위치하도록 올린다.
    */
    yAnchor:
      2.35,

    zIndex:
      2
  });

}


function getMapCategoryEmoji(
  category
) {

  if (
    category ===
    "restaurant"
  ) {

    return "🍽️";

  }


  if (
    category ===
    "cafe"
  ) {

    return "☕";

  }


  return "🎡";

}


function getMapCategoryLabel(
  category
) {

  if (
    category ===
    "restaurant"
  ) {

    return "음식점";

  }


  if (
    category ===
    "cafe"
  ) {

    return "카페";

  }


  return "놀 곳";

}


function getDateMapPlaceKey(
  place
) {

  return (
    place.category
    +
    ":"
    +
    String(
      place.id
    )
  );

}


function makeDateMapInfoContent(
  place
) {

  const address =
    place.address
    ||
    "주소 없음";


  return `
    <div class="map-info-window">
      <strong>
        ${escapeHtml(place.name)}
      </strong>
      <span>
        ${escapeHtml(address)}
      </span>
    </div>
  `;

}


async function openDateMap() {
  const requestId = ++navigationSequence;

  try {

    /*
      현재 날짜에서 수정한
      시간/메모가 있다면 먼저 저장
    */

    await saveDateInfo(
      false
    );


    /*
      지도에 들어갈 때도
      상대방이 추가한 최신 후보를 다시 받음
    */

    const refreshed =
      await refreshFromServer(
        "지도 정보 불러오는 중...",
        "date"
      );


    if (!refreshed || requestId !== navigationSequence) {
      return;
    }


    pushAppHistory(
      "map",
      {
        date:
          selectedDate
      }
    );


    showScreen(
      "mapScreen"
    );


    /*
      screen이 display:block으로 바뀐 뒤
      지도를 생성해야 크기 계산이 안정적임
    */

    setTimeout(
      function() {

        renderDateMap();

      },
      80
    );


  } catch (error) {
    if (error.keepEditing) return;

    console.error(
      "지도 열기 실패:",
      error
    );


    alert(
      "지도를 여는 중 오류가 발생했어.\n"
      +
      error.message
    );

  }

}


function renderDateMap() {

  const mapElement =
    document
      .getElementById(
        "dateMap"
      );


  if (
    typeof kakao ===
      "undefined"
    ||
    !kakao.maps
  ) {

    mapElement.innerHTML = `
      <div style="
        width:100%;
        height:100%;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:20px;
        color:#999;
        text-align:center;
        line-height:1.6;
      ">
        카카오 지도를 불러오지 못했어.<br>
        잠시 뒤 다시 시도해줘.
      </div>
    `;


    renderDateMapPlaceList(
      getAllPlacesForSelectedDate()
    );


    return;

  }


  mapElement.innerHTML =
    "";


  dateMapMarkerEntries =
    {};


  dateMap =
    new kakao.maps.Map(
      mapElement,
      {
        center:
          new kakao.maps.LatLng(
            37.5665,
            126.9780
          ),

        level:
          7
      }
    );


  dateMapInfoWindow =
    new kakao.maps.InfoWindow({
      zIndex:
        5
    });


  const places =
    getAllPlacesForSelectedDate();


  const validPlaces =
    places.filter(
      hasPlaceCoordinates
    );


  const bounds =
    new kakao.maps.LatLngBounds();


  validPlaces
    .forEach(
      place => {

        const position =
          new kakao.maps.LatLng(
            Number(
              place.latitude
            ),
            Number(
              place.longitude
            )
          );


        const marker =
          new kakao.maps.Marker({
            map:
              dateMap,

            position:
              position,

            image:
              getDateMapMarkerImage(
                place.category
              ),

            title:
              place.name
          });


        const nameOverlay =
          createDateMapNameOverlay(
            place,
            position
          );


        kakao.maps.event
          .addListener(
            marker,
            "click",
            function() {

              showDateMapPlaceInfo(
                place
              );

            }
          );


        dateMapMarkerEntries[
          getDateMapPlaceKey(
            place
          )
        ] = {
          marker:
            marker,

          nameOverlay:
            nameOverlay,

          position:
            position,

          place:
            place
        };


        bounds.extend(
          position
        );

      }
    );


  /*
    후보가 1곳이면 너무 과하게 확대되지 않도록
    직접 중심/레벨 지정.
    2곳 이상이면 모두 보이도록 bounds 적용.
  */

  if (
    validPlaces.length ===
    1
  ) {

    const firstEntry =
      dateMapMarkerEntries[
        getDateMapPlaceKey(
          validPlaces[0]
        )
      ];


    dateMap.setCenter(
      firstEntry.position
    );


    dateMap.setLevel(
      3
    );

  }
  else if (
    validPlaces.length >
    1
  ) {

    dateMap.setBounds(
      bounds
    );

  }


  renderDateMapPlaceList(
    places
  );

}


function renderDateMapPlaceList(
  places
) {

  const container =
    document
      .getElementById(
        "mapPlaceList"
      );


  const warning =
    document
      .getElementById(
        "mapCoordinateWarning"
      );


  container.innerHTML =
    "";


  if (
    places.length ===
    0
  ) {

    container.innerHTML = `
      <div class="map-empty">
        <div class="map-empty-emoji">
          🗺️
        </div>
        아직 등록된 후보가 없어
      </div>
    `;


    warning.style.display =
      "none";


    return;

  }


  let hasMissingCoordinates =
    false;


  places
    .forEach(
      place => {

        const hasCoordinates =
          hasPlaceCoordinates(
            place
          );


        if (!hasCoordinates) {

          hasMissingCoordinates =
            true;

        }


        const button =
          document
            .createElement(
              "button"
            );


        button.type =
          "button";


        button.className =
          "map-place-button";


        button.disabled =
          !hasCoordinates;


        const colorDot =
          document
            .createElement(
              "div"
            );


        colorDot.className =
          "map-place-color-dot "
          +
          getDateMapCategoryClass(
            place.category
          );


        const text =
          document
            .createElement(
              "div"
            );


        text.className =
          "map-place-text";


        const name =
          document
            .createElement(
              "div"
            );


        name.className =
          "map-place-name";


        name.textContent =
          place.name;


        const address =
          document
            .createElement(
              "div"
            );


        address.className =
          "map-place-address";


        address.textContent =
          place.address
          ||
          "주소 없음";


        const category =
          document
            .createElement(
              "div"
            );


        category.className =
          "map-place-category";


        category.textContent =
          getMapCategoryLabel(
            place.category
          );


        text.appendChild(
          name
        );


        text.appendChild(
          address
        );


        button.appendChild(
          colorDot
        );


        button.appendChild(
          text
        );


        button.appendChild(
          category
        );


        if (
          hasCoordinates
        ) {

          button.addEventListener(
            "click",
            function() {

              focusDateMapPlace(
                place
              );

            }
          );

        }


        container.appendChild(
          button
        );

      }
    );


  warning.style.display =
    hasMissingCoordinates
    ?
    "block"
    :
    "none";

}


function focusDateMapPlace(
  place
) {

  if (
    !dateMap
  ) {

    return;

  }


  const entry =
    dateMapMarkerEntries[
      getDateMapPlaceKey(
        place
      )
    ];


  if (!entry) {
    return;
  }


  dateMap.panTo(
    entry.position
  );


  dateMap.setLevel(
    3
  );


  showDateMapPlaceInfo(
    place
  );

}


function showDateMapPlaceInfo(
  place
) {

  if (
    !dateMap
    ||
    !dateMapInfoWindow
  ) {

    return;

  }


  const entry =
    dateMapMarkerEntries[
      getDateMapPlaceKey(
        place
      )
    ];


  if (!entry) {
    return;
  }


  dateMapInfoWindow.setContent(
    makeDateMapInfoContent(
      place
    )
  );


  dateMapInfoWindow.open(
    dateMap,
    entry.marker
  );

}


/* =====================================================
   ESCAPE HTML
===================================================== */

function escapeHtml(
  text
) {

  if (!text) {
    return "";
  }


  return String(text)

    .replaceAll(
      "&",
      "&amp;"
    )

    .replaceAll(
      "<",
      "&lt;"
    )

    .replaceAll(
      ">",
      "&gt;"
    )

    .replaceAll(
      '"',
      "&quot;"
    )

    .replaceAll(
      "'",
      "&#039;"
    );

}


/* =====================================================
   INITIALIZE
===================================================== */

async function initializeApp() {

  if (window.OurDateGate) await OurDateGate.ready;

  initializeTimePicker();


  /*
    최초 진입 페이지를 달력 상태로 등록한다.
    이후 앱 내부 이동부터 pushState가 쌓인다.
  */
  history.replaceState(
    makeCalendarHistoryState(),
    ""
  );


  showLoading(
    "데이트 불러오는 중..."
  );


  try {

    await OurDateStore.loadSharedProfile({migrate:true});
    await loadMonthData();


    renderCalendar();


    refreshStorageUsage();


    startStorageUsagePolling();


  } catch (error) {

    console.error(
      "초기 데이터 로드 실패:",
      error
    );


    alert(
      "서버 데이터를 불러오지 못했어.\n"
      +
      error.message
    );


    renderCalendar();


  } finally {

    hideLoading();

  }

}



const appModalStack = [];
let handlingModalPop = false;
let skipModalPop = false;
const modalCloseFunctions = {
  placeModal: () => closePlaceModal(),
  timePickerModal: () => closeTimePicker(),
  monthPickerModal: () => closeMonthPicker(),
  imageViewer: () => closeImageViewer(),
  deleteOverlay: () => closeDeleteModal()
};

function trackModalOpen(id) {
  const element = document.getElementById(id);
  if (!element?.classList.contains("active") || appModalStack.some(entry => entry.id === id)) return;
  const baseState = history.state || makeCalendarHistoryState();
  const state = { ...baseState, ourDateApp: true, ourDateModal: id };
  appModalStack.push({ id, baseState, state });
  history.pushState(state, "");
}

function trackModalClose(id) {
  if (document.getElementById(id)?.classList.contains("active")) return;
  const index = appModalStack.findIndex(entry => entry.id === id);
  if (index < 0) return;
  const wasTop = index === appModalStack.length - 1;
  appModalStack.splice(index, 1);
  if (wasTop && !handlingModalPop && history.state?.ourDateModal === id) {
    skipModalPop = true;
    history.back();
  }
}

async function handleAppPopState(state) {
  if (skipModalPop) { skipModalPop = false; return; }
  const top = appModalStack[appModalStack.length - 1];
  if (top && state?.ourDateModal !== top.id) {
    handlingModalPop = true;
    try { modalCloseFunctions[top.id](); }
    finally { handlingModalPop = false; }
    if (document.getElementById(top.id)?.classList.contains("active")) {
      history.pushState(top.state, "");
      return;
    }
    if (state?.screen === top.baseState.screen && state?.date === top.baseState.date && state?.category === top.baseState.category) return;
  }
  if (state?.ourDateModal && !appModalStack.some(entry => entry.id === state.ourDateModal)) {
    state = { ...state };
    delete state.ourDateModal;
    history.replaceState(state, "");
  }
  await restoreAppHistoryState(state);
}

function installModalNavigation() {
  const openPlaceBase = openPlaceModal;
  openPlaceModal = function(...args) { openPlaceBase(...args); placeEditorBaseline = placeFormSignature(); trackModalOpen("placeModal"); };
  const editPlaceBase = editPlace;
  editPlace = function(...args) { editPlaceBase(...args); placeEditorBaseline = placeFormSignature(); trackModalOpen("placeModal"); };
  const closePlaceBase = closePlaceModal;
  closePlaceModal = function(...args) { closePlaceBase(...args); trackModalClose("placeModal"); };
  const openTimeBase = openTimePicker;
  openTimePicker = function(...args) { openTimeBase(...args); trackModalOpen("timePickerModal"); };
  const closeTimeBase = closeTimePicker;
  closeTimePicker = function(...args) { closeTimeBase(...args); trackModalClose("timePickerModal"); };
  const openMonthBase = openMonthPicker;
  openMonthPicker = function(...args) { openMonthBase(...args); trackModalOpen("monthPickerModal"); };
  const closeMonthBase = closeMonthPicker;
  closeMonthPicker = function(...args) { closeMonthBase(...args); trackModalClose("monthPickerModal"); };
  const openImageBase = openImageViewer;
  openImageViewer = function(...args) { openImageBase(...args); trackModalOpen("imageViewer"); };
  const closeImageBase = closeImageViewer;
  closeImageViewer = function(...args) { closeImageBase(...args); trackModalClose("imageViewer"); };
  const openDeleteBase = deletePlace;
  deletePlace = function(...args) { openDeleteBase(...args); trackModalOpen("deleteOverlay"); };
  const closeDeleteBase = closeDeleteModal;
  closeDeleteModal = function(...args) { closeDeleteBase(...args); trackModalClose("deleteOverlay"); };
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
    if (document.getElementById("successOverlay")?.classList.contains("active")) {
      event.preventDefault(); event.stopImmediatePropagation(); closeSuccessModal(); return;
    }
    const top = appModalStack[appModalStack.length - 1];
    if (!top) return;
    event.preventDefault(); event.stopImmediatePropagation(); modalCloseFunctions[top.id]();
  }, true);
}
installModalNavigation();

initializeApp();


/* =====================================================
   PWA
===================================================== */

if (
  "serviceWorker"
  in
  navigator
) {

  window
    .addEventListener(
      "load",
      function() {

        navigator
          .serviceWorker
          .register(
            "./sw.js"
          )
          .catch(
            function(error) {

              console.warn(
                "Service Worker 등록 실패:",
                error
              );

            }
          );

      }
    );

}

