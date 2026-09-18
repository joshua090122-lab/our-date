/*
 * Our Date - Experimental CSS two-finger map rotation
 *
 * 목적:
 * - Kakao Web Map 자체 bearing API 없이 CSS transform으로
 *   지도 전체를 시험적으로 회전시킨다.
 * - 두 손가락을 비틀면 회전.
 * - 우측 상단 N 버튼을 누르면 북쪽(0°)으로 복귀.
 *
 * 롤백:
 * - index.html에서 이 파일을 불러오는 <script> 한 줄만 삭제하면 끝.
 */

(function () {
  "use strict";

  const WRAPPER_ID =
    "ourDateMapRotationViewport";

  const RESET_BUTTON_ID =
    "ourDateMapRotationReset";

  const ANGLE_LABEL_ID =
    "ourDateMapRotationAngle";

  const ROTATION_DEAD_ZONE_DEG =
    1.2;

  /*
   * 회전할 때 모서리에 빈 공간이 보이지 않도록
   * CSS scale을 자동으로 증가시킨다.
   *
   * 너무 크게 확대돼 보이는 것을 막기 위해
   * 실험판에서는 최대 1.52배로 제한한다.
   */
  const MAX_COVER_SCALE =
    1.52;


  const state = {
    mapElement:
      null,

    wrapper:
      null,

    resetButton:
      null,

    angleLabel:
      null,

    rotation:
      0,

    gestureStartAngle:
      null,

    gestureStartRotation:
      0,

    gestureActive:
      false,

    transitionTimer:
      null
  };


  /* =====================================================
     STYLE
  ===================================================== */

  function injectStyles() {

    if (
      document.getElementById(
        "ourDateMapCssRotateStyles"
      )
    ) {
      return;
    }


    const style =
      document.createElement(
        "style"
      );

    style.id =
      "ourDateMapCssRotateStyles";

    style.textContent = `
      #${WRAPPER_ID} {
        position: relative;

        width: 100%;
        height: 430px;

        overflow: hidden;

        background: #f2f2f2;

        touch-action: auto;

        /*
          회전된 지도 가장자리가
          바깥 UI를 덮지 못하게 함.
        */
        contain: paint;
      }

      #${WRAPPER_ID}
      > #dateMap {
        position: absolute;

        left: 0;
        top: 0;

        width: 100%;
        height: 100%;

        margin: 0;

        transform-origin: 50% 50%;
        transform:
          rotate(0deg)
          scale(1);

        will-change: transform;

        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
      }

      #${WRAPPER_ID}
      > #dateMap.our-date-map-rotation-resetting {
        transition:
          transform
          220ms
          cubic-bezier(
            0.22,
            0.61,
            0.36,
            1
          );
      }

      .our-date-map-rotation-ui {
        position: absolute;

        top: 12px;
        right: 12px;

        z-index: 50;

        display: flex;
        flex-direction: column;
        align-items: center;

        gap: 6px;

        pointer-events: none;
      }

      #${RESET_BUTTON_ID} {
        width: 44px;
        height: 44px;

        display: flex;
        align-items: center;
        justify-content: center;

        padding: 0;

        border:
          1px solid
          rgba(0,0,0,0.13);

        border-radius: 50%;

        background:
          rgba(255,255,255,0.96);

        color: #333;

        box-shadow:
          0 2px 9px
          rgba(0,0,0,0.17);

        pointer-events: auto;

        -webkit-tap-highlight-color:
          transparent;
      }

      #${RESET_BUTTON_ID}:active {
        transform: scale(0.96);
      }

      .our-date-map-north-icon {
        position: relative;

        width: 27px;
        height: 27px;

        display: flex;
        align-items: center;
        justify-content: center;
      }

      .our-date-map-north-letter {
        position: absolute;

        top: -1px;
        left: 50%;

        transform:
          translateX(-50%);

        color: #e54c5e;

        font-size: 10px;
        font-weight: 900;
        line-height: 1;
      }

      .our-date-map-north-arrow {
        position: absolute;

        left: 50%;
        top: 9px;

        width: 0;
        height: 0;

        transform:
          translateX(-50%);

        border-left:
          5px solid transparent;

        border-right:
          5px solid transparent;

        border-bottom:
          14px solid #e54c5e;
      }

      .our-date-map-south-arrow {
        position: absolute;

        left: 50%;
        top: 12px;

        width: 0;
        height: 0;

        transform:
          translateX(-50%);

        border-left:
          5px solid transparent;

        border-right:
          5px solid transparent;

        border-top:
          14px solid #7d7d7d;
      }

      #${ANGLE_LABEL_ID} {
        min-width: 39px;

        padding:
          4px
          7px;

        border-radius:
          999px;

        background:
          rgba(35,35,35,0.76);

        color: white;

        font-size: 10px;
        font-weight: 750;
        line-height: 1.2;
        text-align: center;

        opacity: 0;

        transition:
          opacity
          120ms ease;

        pointer-events: none;
      }

      #${ANGLE_LABEL_ID}.visible {
        opacity: 1;
      }

      @media
      (max-width: 480px) {

        #${WRAPPER_ID} {
          height: 390px;
        }

        .our-date-map-rotation-ui {
          top: 10px;
          right: 10px;
        }

        #${RESET_BUTTON_ID} {
          width: 43px;
          height: 43px;
        }
      }
    `;


    document.head.appendChild(
      style
    );

  }


  /* =====================================================
     ANGLE / SCALE
  ===================================================== */

  function normalizeRotation(
    angle
  ) {

    let value =
      Number(
        angle
      )
      ||
      0;


    value =
      (
        (
          value
          +
          180
        )
        %
        360
        +
        360
      )
      %
      360
      -
      180;


    return value;

  }


  function normalizeDelta(
    angle
  ) {

    return normalizeRotation(
      angle
    );

  }


  function getTwoTouchAngle(
    touch1,
    touch2
  ) {

    const dx =
      touch2.clientX
      -
      touch1.clientX;

    const dy =
      touch2.clientY
      -
      touch1.clientY;


    return (
      Math.atan2(
        dy,
        dx
      )
      *
      180
      /
      Math.PI
    );

  }


  function calculateCoverScale(
    rotation
  ) {

    if (
      !state.wrapper
    ) {
      return 1;
    }


    const width =
      state.wrapper.clientWidth;

    const height =
      state.wrapper.clientHeight;


    if (
      !width
      ||
      !height
    ) {
      return 1;
    }


    const radians =
      Math.abs(
        rotation
      )
      *
      Math.PI
      /
      180;


    const cos =
      Math.abs(
        Math.cos(
          radians
        )
      );

    const sin =
      Math.abs(
        Math.sin(
          radians
        )
      );


    /*
      같은 크기의 직사각형을 회전시킨 뒤
      원래 viewport의 네 모서리를 가리기 위한
      최소 scale 근사치.
    */
    const horizontalRequirement =
      cos
      +
      (
        height
        /
        width
      )
      *
      sin;

    const verticalRequirement =
      cos
      +
      (
        width
        /
        height
      )
      *
      sin;


    const required =
      Math.max(
        1,
        horizontalRequirement,
        verticalRequirement
      );


    return Math.min(
      required,
      MAX_COVER_SCALE
    );

  }


  /* =====================================================
     RENDER ROTATION
  ===================================================== */

  function updateRotationUi() {

    if (
      !state.resetButton
      ||
      !state.angleLabel
    ) {
      return;
    }


    const absRotation =
      Math.abs(
        state.rotation
      );


    const isNorth =
      absRotation <
      0.5;


    state.resetButton.style.opacity =
      isNorth
      ?
      "0.82"
      :
      "1";


    state.angleLabel.textContent =
      Math.round(
        state.rotation
      )
      +
      "°";


    state.angleLabel.classList.toggle(
      "visible",
      !isNorth
    );

  }


  function renderRotation(
    rotation
  ) {

    if (
      !state.mapElement
    ) {
      return;
    }


    state.rotation =
      normalizeRotation(
        rotation
      );


    const scale =
      calculateCoverScale(
        state.rotation
      );


    state.mapElement.style.transform =
      "rotate("
      +
      state.rotation
      +
      "deg) "
      +
      "scale("
      +
      scale
      +
      ")";


    updateRotationUi();

  }


  /* =====================================================
     TOUCH GESTURE
  ===================================================== */

  function onTouchStart(
    event
  ) {

    if (
      event.touches.length <
      2
    ) {

      state.gestureActive =
        false;

      state.gestureStartAngle =
        null;

      return;

    }


    const angle =
      getTwoTouchAngle(
        event.touches[0],
        event.touches[1]
      );


    state.gestureStartAngle =
      angle;

    state.gestureStartRotation =
      state.rotation;

    state.gestureActive =
      true;

  }


  function onTouchMove(
    event
  ) {

    if (
      !state.gestureActive
      ||
      event.touches.length <
        2
      ||
      state.gestureStartAngle ===
        null
    ) {
      return;
    }


    const currentAngle =
      getTwoTouchAngle(
        event.touches[0],
        event.touches[1]
      );


    const delta =
      normalizeDelta(
        currentAngle
        -
        state.gestureStartAngle
      );


    if (
      Math.abs(
        delta
      )
      <
      ROTATION_DEAD_ZONE_DEG
    ) {
      return;
    }


    /*
      preventDefault를 일부러 호출하지 않는다.

      이유:
      카카오맵의 기존 두 손가락 확대/축소를
      가능한 한 그대로 살려두기 위해서다.

      따라서 두 손가락을 벌리면서 동시에 비틀면:
      - 카카오맵: 확대/축소
      - 이 애드온: CSS 회전
      이 동시에 일어나는 실험적 동작이다.
    */
    renderRotation(
      state.gestureStartRotation
      +
      delta
    );

  }


  function onTouchEnd(
    event
  ) {

    if (
      event.touches.length >=
      2
    ) {

      /*
        손가락 두 개가 계속 남아 있으면
        남아 있는 두 손가락을 새 기준으로 잡는다.
      */
      state.gestureStartAngle =
        getTwoTouchAngle(
          event.touches[0],
          event.touches[1]
        );

      state.gestureStartRotation =
        state.rotation;

      state.gestureActive =
        true;

      return;

    }


    state.gestureActive =
      false;

    state.gestureStartAngle =
      null;

    state.gestureStartRotation =
      state.rotation;

  }


  function onTouchCancel() {

    state.gestureActive =
      false;

    state.gestureStartAngle =
      null;

    state.gestureStartRotation =
      state.rotation;

  }


  /* =====================================================
     RESET NORTH
  ===================================================== */

  function resetNorth() {

    if (
      !state.mapElement
    ) {
      return;
    }


    clearTimeout(
      state.transitionTimer
    );


    state.mapElement
      .classList
      .add(
        "our-date-map-rotation-resetting"
      );


    renderRotation(
      0
    );


    state.transitionTimer =
      setTimeout(
        function () {

          if (
            state.mapElement
          ) {

            state.mapElement
              .classList
              .remove(
                "our-date-map-rotation-resetting"
              );

          }

        },
        260
      );

  }


  /* =====================================================
     DOM SETUP
  ===================================================== */

  function createRotationUi() {

    const ui =
      document.createElement(
        "div"
      );

    ui.className =
      "our-date-map-rotation-ui";


    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.id =
      RESET_BUTTON_ID;

    button.title =
      "북쪽으로 되돌리기";

    button.setAttribute(
      "aria-label",
      "지도를 북쪽 방향으로 되돌리기"
    );

    button.innerHTML = `
      <span
        class="our-date-map-north-icon"
        aria-hidden="true"
      >
        <span
          class="our-date-map-north-letter"
        >
          N
        </span>

        <span
          class="our-date-map-north-arrow"
        ></span>

        <span
          class="our-date-map-south-arrow"
        ></span>
      </span>
    `;


    const angle =
      document.createElement(
        "div"
      );

    angle.id =
      ANGLE_LABEL_ID;

    angle.textContent =
      "0°";


    ui.appendChild(
      button
    );

    ui.appendChild(
      angle
    );


    state.wrapper.appendChild(
      ui
    );


    state.resetButton =
      button;

    state.angleLabel =
      angle;


    button.addEventListener(
      "click",
      function (
        event
      ) {

        event.stopPropagation();

        resetNorth();

      }
    );

  }


  function wrapMapElement() {

    const mapElement =
      document.getElementById(
        "dateMap"
      );


    if (
      !mapElement
    ) {

      console.warn(
        "지도 회전 애드온: #dateMap을 찾지 못했어."
      );

      return false;

    }


    /*
      이미 설치된 경우 중복 설치 방지.
    */
    const existingWrapper =
      document.getElementById(
        WRAPPER_ID
      );


    if (
      existingWrapper
    ) {

      state.mapElement =
        mapElement;

      state.wrapper =
        existingWrapper;

      state.resetButton =
        document.getElementById(
          RESET_BUTTON_ID
        );

      state.angleLabel =
        document.getElementById(
          ANGLE_LABEL_ID
        );

      return true;

    }


    const wrapper =
      document.createElement(
        "div"
      );

    wrapper.id =
      WRAPPER_ID;


    mapElement.parentNode.insertBefore(
      wrapper,
      mapElement
    );


    wrapper.appendChild(
      mapElement
    );


    /*
      기존 .date-map의 height 규칙은
      wrapper가 대신 맡는다.

      Kakao 지도 본체는 wrapper의
      100% x 100% 크기를 사용한다.
    */
    mapElement.classList.remove(
      "date-map"
    );


    state.mapElement =
      mapElement;

    state.wrapper =
      wrapper;


    return true;

  }


  function attachTouchListeners() {

    if (
      !state.wrapper
    ) {
      return;
    }


    /*
      capture:true:
      카카오맵 내부 DOM이 touch 이벤트를 처리하기 전에
      두 손가락 각도를 관찰할 수 있도록 한다.

      passive:true:
      이 애드온이 기본 확대/이동 동작을 막지 않음을 명시한다.
    */
    state.wrapper.addEventListener(
      "touchstart",
      onTouchStart,
      {
        capture:
          true,

        passive:
          true
      }
    );


    state.wrapper.addEventListener(
      "touchmove",
      onTouchMove,
      {
        capture:
          true,

        passive:
          true
      }
    );


    state.wrapper.addEventListener(
      "touchend",
      onTouchEnd,
      {
        capture:
          true,

        passive:
          true
      }
    );


    state.wrapper.addEventListener(
      "touchcancel",
      onTouchCancel,
      {
        capture:
          true,

        passive:
          true
      }
    );

  }


  /* =====================================================
     DESKTOP TEST SUPPORT
  ===================================================== */

  function attachDesktopTestSupport() {

    if (
      !state.wrapper
    ) {
      return;
    }


    /*
      실제 기능은 모바일 두 손가락 회전용.

      PC에서 시험하고 싶을 때만:
      Shift + 마우스 휠 = 5도씩 회전.
      일반 휠은 카카오맵 줌에 그대로 맡긴다.
    */
    state.wrapper.addEventListener(
      "wheel",
      function (
        event
      ) {

        if (
          !event.shiftKey
        ) {
          return;
        }


        event.preventDefault();


        const direction =
          event.deltaY > 0
          ?
          1
          :
          -1;


        renderRotation(
          state.rotation
          +
          direction
          *
          5
        );

      },
      {
        passive:
          false
      }
    );

  }


  /* =====================================================
     INITIALIZE
  ===================================================== */

  function initialize() {

    injectStyles();


    if (
      !wrapMapElement()
    ) {
      return;
    }


    createRotationUi();

    attachTouchListeners();

    attachDesktopTestSupport();

    renderRotation(
      0
    );


    /*
      디버깅용:
      콘솔에서 아래처럼 직접 회전 가능.

      ourDateMapRotation.set(30)
      ourDateMapRotation.reset()
      ourDateMapRotation.get()
    */
    window.ourDateMapRotation = {
      set:
        function (
          angle
        ) {

          renderRotation(
            angle
          );

        },

      reset:
        resetNorth,

      get:
        function () {

          return state.rotation;

        }
    };

  }


  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      initialize,
      {
        once:
          true
      }
    );

  }
  else {

    initialize();

  }

})();
