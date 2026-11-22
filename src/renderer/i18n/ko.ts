// 화면 문구 (한국어). 새 문구는 여기에 추가한다.
export const ko = {
  appTitle: 'Octopus',
  dbOpenFailed:
    '저장소(데이터베이스)를 열지 못했어요. 앱을 완전히 종료한 뒤 다시 실행해 보세요. 계속되면 사용자 데이터 폴더의 octopus.db 파일을 백업해 두세요.',

  tasks: {
    viewsNavLabel: '보기',
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
      close: '닫기'
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
      textTooLong: '입력이 너무 길어요. 줄여서 다시 시도해 주세요.',
      invalid_input: '입력한 내용을 확인한 뒤 다시 시도해 주세요.',
      not_found: '이미 삭제되었거나 찾을 수 없는 할 일이에요. 목록을 새로 불러왔어요.',
      db_unavailable:
        '저장소를 열지 못했어요. 앱을 완전히 종료한 뒤 다시 시작해 주세요. 계속되면 octopus.db 파일을 백업해 두세요.',
      internal: '문제가 생겼어요. 잠시 뒤 다시 시도해 주세요. 계속되면 앱을 다시 시작해 주세요.'
    }
  }
} as const
