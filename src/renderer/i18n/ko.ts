// 화면 문구 (한국어). 새 문구는 여기에 추가한다.
export const ko = {
  appTitle: 'Octopus',
  dbOpenFailed:
    '저장소(데이터베이스)를 열지 못했어요. 앱을 완전히 종료한 뒤 다시 실행해 보세요. 계속되면 사용자 데이터 폴더의 octopus.db 파일을 백업해 두세요.',

  nav: {
    label: '메뉴',
    collapse: '메뉴 접기',
    expand: '메뉴 펼치기',
    home: '홈',
    tasks: '할 일',
    routines: '체크리스트',
    memos: '메모',
    command: '지시하기',
    arms: 'Arms',
    soon: '준비 중',
    commandNeedsModel: '모델을 연결하면 쓸 수 있어요',
    settings: '설정',
    arrange: '화면 배치',
    arrangeHint: '홈 화면에서 카드를 옮기고 크기를 바꿀 수 있어요.'
  },

  pie: {
    menuLabel: 'Octopus 메뉴',
    menuHint: '누르고 끌어서 고르기 · 짧게 누르면 펼침',
    wedgesLabel: '원형 메뉴',
    // 원형 메뉴 칸에 쓰는 짧은 이름
    labels: {
      'nav:home': '홈',
      'nav:tasks': '할 일',
      'nav:routines': '체크리스트',
      'nav:memos': '메모 보기',
      'nav:settings': '설정',
      'task:quickAdd': '할 일 추가',
      'memo:quickAdd': '메모',
      command: '지시하기',
      'arm:google-calendar': '캘린더',
      'arm:mail': '메일',
      'arm:obsidian': '옵시디언',
      wiki: '위키',
      arms: 'Arms'
    },
    // 설정 화면의 목록에 쓰는 설명이 있는 이름
    longLabels: {
      'nav:home': '홈 화면',
      'nav:tasks': '할 일 화면',
      'nav:routines': '체크리스트 화면',
      'nav:memos': '메모 화면',
      'nav:settings': '설정 화면',
      'task:quickAdd': '할 일 바로 추가',
      'memo:quickAdd': '메모 바로 쓰기',
      command: '지시하기',
      'arm:google-calendar': '캘린더 (Arm 연결 필요)',
      'arm:mail': '메일 (Arm 연결 필요)',
      'arm:obsidian': '옵시디언 (Arm 연결 필요)',
      wiki: '위키',
      arms: 'Arms 관리'
    },
    // 지금 쓸 수 없는 칸에 가리키면 보이는 이유
    reasons: {
      command: '설정의 "모델 연결"에서 키나 서버 주소를 넣으면 쓸 수 있어요.',
      'arm:google-calendar': '캘린더 Arm 을 연결하면 쓸 수 있어요.',
      'arm:mail': '메일 Arm 을 연결하면 쓸 수 있어요.',
      'arm:obsidian': '옵시디언 Arm 을 연결하면 쓸 수 있어요.',
      wiki: '위키는 곧 준비돼요.',
      arms: 'Arms 화면은 곧 준비돼요.'
    },
    deletedShortcut: '지워진 바로가기',
    deletedShortcutReason: '지워진 바로가기예요. 설정에서 다른 동작을 골라 주세요.',
    shortcutLong: (label: string) => `바로가기: ${label}`
  },

  settings: {
    title: '설정',
    pieTitle: '원형 메뉴',
    pieHelp: '홈 가운데 원을 누르고 끌면 나오는 8칸이에요. 칸마다 하고 싶은 동작을 골라 주세요.',
    slotLabel: (n: number, position: string) => `원형 메뉴 ${n}번 칸 (${position})`,
    // 12시부터 시계 방향
    positions: ['위', '오른쪽 위', '오른쪽', '오른쪽 아래', '아래', '왼쪽 아래', '왼쪽', '왼쪽 위'],
    reset: '기본값으로',
    soon: '준비 중',
    model: {
      title: '모델 연결',
      help: '지시하기가 쓸 AI 모델을 연결해요. 키는 이 PC 에 암호화해 저장하고, 화면에는 다시 보여 주지 않아요.',
      providerLabel: '연결 방식',
      providers: { anthropic: 'Anthropic', 'openai-compatible': 'OpenAI 호환' },
      keyLabel: 'API 키',
      keyOptionalLabel: 'API 키 (선택)',
      keyPlaceholder: '키를 붙여 넣고 저장하세요',
      saveKey: '키 저장',
      saved: '저장됨',
      notSaved: '저장된 키 없음',
      clearKey: '키 지우기',
      clearConfirm: '저장된 키를 지울까요? 지우면 지시하기를 쓸 수 없어요.',
      clearYes: '지우기',
      clearNo: '취소',
      modelLabel: '모델',
      baseUrlLabel: '서버 주소',
      baseUrlPlaceholder: 'https://api.openai.com/v1  또는  http://localhost:1234/v1',
      modelNameLabel: '모델 이름',
      saveServer: '서버 저장',
      serverSaved: '서버 설정을 저장했어요.',
      keySaved: '키를 저장했어요.',
      keyCleared: '키를 지웠어요.',
      errors: {
        baseUrl: '주소는 http:// 또는 https:// 로 시작해야 해요.',
        modelName: '모델 이름을 적어 주세요.',
        key: '키를 붙여 넣어 주세요.'
      }
    }
  },

  home: {
    dateHeading: (month: number, day: number, weekday: string) => `${month}월 ${day}일 ${weekday}요일`,
    cards: {
      todo: '오늘 할 일',
      calendar: '오늘 일정',
      memo: '메모',
      shortcuts: '바로가기'
    },
    moveLabel: (card: string, direction: string) => `${card} 카드를 ${direction}`,
    directions: { up: '위로', down: '아래로', left: '왼쪽으로', right: '오른쪽으로' },
    arrows: { up: '↑', down: '↓', left: '←', right: '→' },
    arranging: '화면 배치 중 — 화살표로 카드 자리를 바꾸고, 카드 사이 경계를 끌어 크기를 바꿔요. 경계를 두 번 누르면 반반으로 돌아와요.',
    resetLayout: '기본 배치',
    doneArranging: '완료',
    columnSeparator: '왼쪽·오른쪽 카드 너비 조절',
    rowSeparator: '위·아래 카드 높이 조절',
    centerSpot: 'Octopus 메뉴 자리',
    todo: {
      overdue: (n: number) => `지난 할 일 ${n}개`,
      empty: '오늘 할 일이 없어요. 위 입력창에 적어 추가해 보세요.',
      viewAll: '전체 보기 →'
    },
    calendar: {
      empty: '연결된 캘린더가 없어요.',
      connect: '캘린더 연결하기',
      loading: '일정을 불러오는 중…',
      connecting: '연결 중…',
      noEvents: '오늘 일정이 없어요.',
      allDay: '종일',
      now: '진행 중',
      reconnect: '다시 연결',
      notConfigured: '이 빌드에는 Google 연결이 아직 설정되지 않았어요.',
      notConfiguredHelp: 'Arms 화면에서 확인할 수 있어요.',
      openArms: 'Arms 화면 열기',
      eventLabel: (title: string) => `일정 열기: ${title}`,
      openFailed: '일정을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.'
    },
    memo: {
      empty: '메모가 없어요. 아래에 한 줄로 적어 보세요.',
      quickLabel: '빠른 메모',
      quickPlaceholder: '한 줄 메모 (Enter)',
      viewAll: '전체 보기 →'
    },
    dialogs: {
      taskTitle: '할 일 추가',
      memoTitle: '메모 쓰기',
      close: '닫기',
      memoLabel: '메모 내용',
      memoPlaceholder: '메모를 적고 Ctrl+Enter 로 저장하세요.',
      save: '저장',
      taskAdded: '할 일을 추가했어요.',
      memoSaved: '메모를 저장했어요.'
    },
    shortcuts: {
      empty: '자주 쓰는 링크, 파일, 폴더를 여기에 모아 두세요.',
      add: '+ 추가',
      addMenuLabel: '바로가기 추가',
      addLink: '링크',
      addFile: '파일',
      addFolder: '폴더',
      urlLabel: '링크 주소',
      urlPlaceholder: 'https://',
      nameLabel: '이름 (선택)',
      submit: '추가',
      cancel: '취소',
      manage: '관리',
      doneManage: '관리 끝',
      rename: '이름 바꾸기',
      renameLabel: (name: string) => `이름: ${name}`,
      save: '저장',
      moveUp: (name: string) => `위로 옮기기: ${name}`,
      moveDown: (name: string) => `아래로 옮기기: ${name}`,
      remove: '삭제',
      confirmRemove: '이 바로가기를 지울까요? (파일이나 폴더는 지워지지 않아요.)',
      confirmRemoveYes: '삭제',
      kinds: { url: '링크', file: '파일', folder: '폴더' },
      errors: {
        url: '주소를 확인해 주세요. http:// 또는 https:// 로 시작해야 해요.',
        label: '이름은 1~100자로 적어 주세요.'
      }
    }
  },

  routines: {
    todayTitle: '오늘의 체크리스트',
    todayEmpty: '오늘 해당하는 루틴이 없어요. 아래에서 루틴을 추가해 보세요.',
    manageTitle: '루틴',
    nameLabel: '루틴 이름',
    namePlaceholder: '예: 아침 스트레칭 (Enter 로 추가)',
    daysLabel: '반복 요일',
    everyDay: '매일',
    weekdays: '평일',
    weekend: '주말',
    weekdayNames: ['일', '월', '화', '수', '목', '금', '토'],
    weekdayLong: ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'],
    add: '추가',
    save: '저장',
    cancel: '취소',
    edit: '편집',
    turnOff: '끄기',
    turnOn: '켜기',
    remove: '삭제',
    off: '꺼짐',
    confirmRemove: '이 루틴을 삭제할까요? 오늘 이후의 미완료 항목만 지워지고, 지난 기록은 남아요.',
    confirmRemoveYes: '삭제',
    empty: '아직 루틴이 없어요. 위에서 이름과 요일을 정해 추가해 보세요.',
    historyTitle: (days: number) => `최근 ${days}일 기록`,
    historyEmpty: '루틴을 추가하면 기록이 여기에 쌓여요.',
    cell: { done: '완료', missed: '못 함', pending: '진행 중', none: '해당 없음' },
    legend: '✓ 완료   ✕ 못 함   ○ 오늘 진행 중   · 해당 없음',
    fieldErrors: {
      title: '이름을 입력해 주세요.',
      days: '요일을 하나 이상 골라 주세요.',
      general: '입력한 내용을 확인해 주세요.'
    }
  },

  memos: {
    newLabel: '새 메모',
    newPlaceholder: '메모를 적고 Ctrl+Enter 로 저장하세요. 여러 줄도 괜찮아요.',
    hint: 'Ctrl+Enter 로 저장',
    save: '저장',
    searchLabel: '메모 검색',
    searchPlaceholder: '메모 검색',
    listLabel: '메모 목록',
    empty: '메모가 없어요. 위 입력창에 적고 Ctrl+Enter 로 저장해 보세요.',
    noResults: '검색 결과가 없어요. 다른 낱말로 찾아 보세요.',
    pinned: '고정',
    pin: '고정',
    unpin: '고정 해제',
    toTask: '할 일로 만들기',
    hasTask: '할 일 있음',
    edit: '수정',
    editLabel: '메모 수정',
    remove: '삭제',
    confirmRemove: '이 메모를 삭제할까요? 연결된 할 일은 그대로 남아요.',
    confirmRemoveYes: '삭제',
    cancel: '취소',
    updated: (when: string) => `수정 ${when}`,
    madeTask: (title: string) => `"${title}" 할 일을 만들었어요. 할 일 탭에서 확인해 보세요.`,
    fieldErrors: { body: '메모 내용을 입력해 주세요.' }
  },

  tasks: {
    candidates: {
      title: (n: number) => `들어온 후보 (${n})`,
      help: '연결된 도구에서 온 할 일 후보예요. 넣기 전에는 할 일이 되지 않아요.',
      accept: '수신함에 넣기',
      dismiss: '무시',
      acceptAll: '전체 넣기',
      dismissAll: '전체 무시',
      openSource: '원본 열기',
      from: (name: string) => `출처: ${name}`,
      due: (date: string) => `마감 ${date}`,
      acceptLabel: (title: string) => `수신함에 넣기: ${title}`,
      dismissLabel: (title: string) => `무시: ${title}`,
      openLabel: (title: string) => `원본 열기: ${title}`
    },
    viewsNavLabel: '보기',
    routineBadge: '루틴',
    views: {
      inbox: '수신함',
      today: '오늘',
      upcoming: '예정',
      someday: '나중에',
      done: '완료'
    },

    quickInputLabel: '빠른 입력',
    quickInputPlaceholder: '할 일을 입력하고 Enter 를 누르세요. 예: 내일 오후 3시 보고서 #업무 !높음',
    previewLabel: '인식한 내용',
    chip: {
      date: '날짜',
      time: '시각',
      project: '프로젝트',
      priority: '우선순위',
      repeat: '반복'
    },

    loading: '불러오는 중이에요…',
    listLabel: '할 일 목록',
    // 같은 화면의 "오늘" 보기 영역과 이름이 겹치지 않게 다르게 쓴다.
    todaySection: '오늘 할 일',
    complete: '완료',
    select: '선택',

    priority: {
      0: '없음',
      1: '낮음',
      2: '중간',
      3: '높음'
    },
    deadline: '마감',
    relativeDay: { today: '오늘', tomorrow: '내일', yesterday: '어제' },
    weekdays: ['일', '월', '화', '수', '목', '금', '토'],
    repeat: {
      daily: '매일',
      weekdays: '평일',
      weekly: '매주',
      monthly: '매월',
      monthlyDay: (day: number) => `매월 ${day}일`,
      yearly: '매년',
      everyDays: (n: number) => `${n}일마다`,
      everyWeeks: (n: number) => `${n}주마다`,
      everyMonths: (n: number) => `${n}개월마다`,
      everyYears: (n: number) => `${n}년마다`
    },

    overdue: {
      title: '지난 할 일',
      selectAll: '전체 선택',
      selectedCount: (n: number) => `${n}개 선택`,
      toToday: '오늘로',
      toSomeday: '나중에',
      reschedule: '날짜 지정',
      dateLabel: '옮길 날짜',
      repeatBlocksSomeday: "반복하는 할 일은 '나중에'로 보낼 수 없어요. 선택에서 빼 주세요."
    },

    empty: {
      inbox: '수신함이 비어 있어요. 위 입력창에 할 일을 적어 보세요.',
      today: "오늘 할 일이 없어요. 입력창에 '오늘 회의' 처럼 적어 추가해 보세요.",
      upcoming: "예정된 할 일이 없어요. '내일 …', '다음주 월 …' 처럼 날짜를 함께 적어 보세요.",
      someday: "나중에 할 일이 없어요. 언젠가 할 일은 상세 화면에서 보관함을 '나중에'로 바꿔 두세요.",
      done: '완료한 할 일이 아직 없어요. 할 일을 체크하면 여기에 모여요.'
    },

    detail: {
      title: '할 일 상세',
      titleField: '제목',
      notes: '메모',
      bucket: '보관함',
      buckets: { inbox: '수신함', scheduled: '예정', someday: '나중에' },
      date: '날짜',
      time: '시각',
      deadline: '마감일',
      priority: '우선순위',
      project: '프로젝트',
      tags: '태그 (쉼표로 구분)',
      repeat: '반복',
      repeatLocksBucket: '반복하는 할 일은 날짜가 필요해서 보관함을 바꿀 수 없어요.',
      save: '저장',
      cancel: '취소',
      remove: '삭제',
      confirmRemove: '이 할 일을 삭제할까요? 되돌릴 수 없어요.',
      confirmRemoveYes: '삭제',
      close: '닫기',
      linkedMemo: '연결된 메모',
      routineLocksDate: '루틴 항목은 날짜와 보관함을 바꿀 수 없어요. 체크리스트 화면에서 루틴 설정을 바꿔 주세요.',
      routineManage: '루틴 항목은 체크리스트에서 관리해요.'
    },

    fieldErrors: {
      title: '제목을 입력해 주세요.',
      notes: '메모를 확인해 주세요.',
      bucket: '보관함을 확인해 주세요.',
      date: '날짜를 확인해 주세요. 예정 보관함에는 날짜가 필요하고, 수신함·나중에에는 날짜를 둘 수 없어요.',
      time: '시각을 확인해 주세요. 예: 15:30',
      deadline: '마감일을 확인해 주세요.',
      priority: '우선순위를 확인해 주세요.',
      project: '프로젝트를 확인해 주세요.',
      tags: '태그를 확인해 주세요.',
      repeat: '반복하는 할 일은 날짜가 있는 예정 보관함에만 둘 수 있어요.',
      general: '입력한 내용을 확인해 주세요.'
    },

    errors: {
      dismiss: '닫기',
      emptyTitle: '할 일 내용이 비어 있어요. 내용을 적고 다시 Enter 를 눌러 주세요.',
      emptyBody: '메모 내용이 비어 있어요. 내용을 적고 다시 저장해 주세요.',
      alreadyLinked: '이 메모에는 이미 할 일이 연결되어 있어요.',
      textTooLong: '입력이 너무 길어요. 줄여서 다시 시도해 주세요.',
      invalid_input: '입력한 내용을 확인한 뒤 다시 시도해 주세요.',
      not_found: '이미 삭제되었거나 찾을 수 없는 항목이에요. 목록을 새로 불러왔어요.',
      not_found_path: '파일이 없어요. 바로가기를 고치거나 지우세요.',
      db_unavailable:
        '저장소를 열지 못했어요. 앱을 완전히 종료한 뒤 다시 시작해 주세요. 계속되면 octopus.db 파일을 백업해 두세요.',
      secure_unavailable: '이 PC 에서는 키를 안전하게 저장할 수 없어요. Windows 에 로그인한 상태인지 확인한 뒤 다시 시도해 주세요.',
      internal: '문제가 생겼어요. 잠시 뒤 다시 시도해 주세요. 계속되면 앱을 다시 시작해 주세요.'
    }
  },
  command: {
    title: '지시하기',
    shortcutHint: 'Ctrl+K',
    close: '닫기',
    chatsLabel: '대화 목록',
    newChat: '새 대화',
    recentChats: '최근 대화',
    noChats: '아직 대화가 없어요.',
    deleteChat: (title: string) => `대화 지우기: ${title}`,
    deleteConfirm: '이 대화를 지울까요?',
    deleteYes: '지우기',
    deleteNo: '취소',
    modelLabel: '모델',
    inputLabel: '지시 내용',
    placeholder: '무엇을 시킬까요?  (Enter 보내기 · Shift+Enter 줄바꿈)',
    send: '보내기',
    thinking: '생각 중…',
    empty: '할 일을 찾거나 추가하고, 메모를 정리하도록 시켜 보세요.',
    conversationLabel: '대화',
    you: '나',
    assistant: 'Octopus',
    approvalLabel: '승인 요청',
    approvalHint: '승인해야 실행돼요. 승인 전에 새 메시지를 보내면 이 요청은 거절 처리돼요.',
    approve: '실행',
    reject: '거절',
    approved: '실행하기로 했어요',
    rejected: '거절했어요',
    sources: { core: '기본', arm: 'Arm', mcp: 'MCP' } as const,
    toolDone: (label: string) => `${label} 완료`,
    toolError: (label: string) => `${label} 실패`,
    toolRejected: (label: string) => `${label} 거절함`,
    unknownTool: (name: string) => `${name} 도구`,
    toolLabels: {
      add_task: '할 일 추가',
      update_task: '할 일 고치기',
      complete_task: '할 일 완료',
      add_memo: '메모 추가'
    } as Record<string, string>,
    readLines: {
      list_tasks: '할 일 목록을 봤어요',
      search_tasks: '할 일을 찾아봤어요',
      list_memos: '메모 목록을 봤어요',
      search_memos: '메모를 찾아봤어요',
      list_routines_today: '오늘 체크리스트를 봤어요'
    } as Record<string, string>,
    readFallback: (name: string) => `${name} 도구로 읽었어요`,
    noKey: {
      title: '모델을 연결해 주세요',
      body: '지시하기를 쓰려면 AI 모델의 키(또는 내 서버 주소)가 필요해요. 설정에서 한 번만 넣으면 돼요. 다른 기능은 그대로 쓸 수 있어요.',
      button: '모델 연결하기'
    },
    errors: {
      no_key: '모델이 연결되어 있지 않아요. 모델 연결하기를 눌러 키를 넣어 주세요.',
      auth: '키가 맞지 않아요. 설정의 모델 연결에서 키를 다시 넣어 주세요.',
      rate_limit: '요청이 너무 많아요. 잠시 뒤 다시 보내 주세요.',
      network: '네트워크에 연결하지 못했어요. 인터넷(또는 서버 주소)을 확인하고 다시 보내 주세요.',
      overloaded: '서비스가 지금 바빠요. 잠시 뒤 다시 보내 주세요.',
      bad_request: '요청을 처리하지 못했어요. 설정의 모델 이름과 서버 주소를 확인해 주세요.',
      refusal: '모델이 이 요청에는 답하지 않았어요. 표현을 바꿔서 다시 말해 보세요.',
      too_long: '답이 길어서 중간에 잘렸어요. 요청을 더 짧게 나눠서 다시 보내 주세요.',
      step_limit: '한 번에 너무 많은 단계가 필요했어요. 요청을 나눠서 다시 보내 주세요.',
      unknown: '문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.'
    } as Record<string, string>
  },
  arms: {
    title: 'Arms',
    subtitle: '다리',
    intro: '쓰는 도구를 끼우고 빼세요. 로그인 한 번이면 돼요. Arm 을 빼도 할 일은 Octopus 에 그대로 남아요.',
    listLabel: 'Arm 목록',
    empty: '아직 연결할 수 있는 Arm 이 없어요. Arm 은 앞으로 하나씩 추가돼요. 그동안에도 할 일·메모·지시하기는 그대로 쓸 수 있어요.',
    statuses: { off: '연결 안 됨', connecting: '연결 중…', on: '연결됨', error: '문제가 있어요' },
    connect: '연결',
    connecting: '연결 중…',
    reconnect: '다시 연결',
    disconnect: '연결 끊기',
    disconnectConfirm: '저장된 로그인 정보가 지워져요. 할 일은 그대로 남아요.',
    disconnectYes: '연결 끊기',
    disconnectNo: '취소',
    autoAccept: '들어온 후보를 확인 없이 수신함에 넣기',
    cardLabel: (name: string) => `${name} Arm`,
    auth: { none: '로그인 없음', oauth: '로그인 한 번으로 연결', apiKey: 'API 키로 연결', folder: '폴더를 골라 연결', mcp: 'MCP 서버' } as Record<string, string>,
    capabilities: {
      'tasks.import': '할 일 가져오기',
      'tasks.export': '할 일 내보내기',
      'events.read': '일정 읽기',
      'events.write': '일정 쓰기(승인 후)',
      links: '원본 링크',
      notify: '알림',
      'command.tools': '지시하기 도구',
      'home.card': '홈 카드'
    } as Record<string, string>,
    mcp: { title: 'MCP 서버', soon: 'MCP 서버는 곧 추가할 수 있어요.' },
    advanced: {
      summary: '고급',
      title: '내 OAuth 클라이언트 쓰기',
      help: '기본 방법이 아니에요. Google Cloud 에서 직접 만든 데스크톱 클라이언트를 쓰려는 경우에만 쓰세요. 입력한 값은 이 PC 에 암호화해 저장하고 화면에는 다시 보여 주지 않아요. 연결을 끊으면 함께 지워져요.',
      clientId: '클라이언트 ID',
      clientSecret: '클라이언트 시크릿 (선택)',
      save: '저장',
      saved: '내 클라이언트 저장됨',
      clear: '지우기',
      errors: { clientId: '클라이언트 ID 는 8~200자의 영문·숫자·점·하이픈으로 적어 주세요.', clientSecret: '시크릿에 쓸 수 없는 글자가 있어요.' }
    }
  }
} as const
