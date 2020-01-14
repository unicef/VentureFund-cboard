import React from 'react';
import { connect } from 'react-redux';
import CommunicatorDialog from './CommunicatorDialog.component';
import { TAB_INDEXES } from './CommunicatorDialog.constants';
import { injectIntl } from 'react-intl';
import API from '../../../api';
import {
  createCommunicator,
  editCommunicator,
  changeCommunicator,
  deleteBoardCommunicator
} from '../Communicator.actions';
import { deleteBoard, deleteApiBoard } from '../../Board/Board.actions';
import { showNotification } from '../../Notifications/Notifications.actions';
import { addBoards, replaceBoard } from '../../Board/Board.actions';
import messages from './CommunicatorDialog.messages';

const BOARDS_PAGE_LIMIT = 10;
const INITIAL_STATE = {
  page: 0,
  total: 0,
  search: '',
  data: []
};

const findLocalBoards = (boards, value = '') => {
  return boards.filter(board => {
    const title = board.name || board.id;

    let returnValue = title.toLowerCase().indexOf(value.toLowerCase()) >= 0;
    returnValue =
      returnValue ||
      (board.author &&
        board.author.toLowerCase().indexOf(value.toLowerCase()) >= 0);

    return returnValue;
  });
};

const STATE_TAB_MAP = {
  [TAB_INDEXES.COMMUNICATOR_BOARDS]: 'communicatorBoards',
  [TAB_INDEXES.PUBLIC_BOARDS]: 'publicBoards',
  [TAB_INDEXES.MY_BOARDS]: 'myBoards'
};

class CommunicatorDialogContainer extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      loading: false,
      boards: props.communicatorBoards, // First time => Communicator Boards Tab
      selectedTab: TAB_INDEXES.COMMUNICATOR_BOARDS,
      totalPages: Math.ceil(
        props.communicatorBoards.length / BOARDS_PAGE_LIMIT
      ),
      page: 1,
      search: '',
      isSearchOpen: false
    };
  }
  /* 
    componentWillReceiveProps({ communicatorBoards }) {
      if (this.state.selectedTab === TAB_INDEXES.COMMUNICATOR_BOARDS) {
        const totalPages = Math.ceil(
          communicatorBoards.length / BOARDS_PAGE_LIMIT
        );
        this.setState({ boards: communicatorBoards, totalPages });
      }
    }
   */
  async onTabChange(event, selectedTab = TAB_INDEXES.COMMUNICATOR_BOARDS) {
    const tabData = await this.doSearch('', 1, selectedTab);
    this.setState({
      ...tabData,
      selectedTab,
      page: 1,
      search: '',
      isSearchOpen: false
    });
  }

  async loadNextPage() {
    const page = this.state.page + 1;
    const selectedTabData = this.state[STATE_TAB_MAP[this.state.selectedTab]];
    const nextApiPage = selectedTabData.page + 1;
    const apiPages = Math.ceil(selectedTabData.total / BOARDS_PAGE_LIMIT);

    let newState = { page };
    let localPages = 0;
    if (this.state.selectedTab === TAB_INDEXES.PUBLIC_BOARDS) {
      const localBoards = findLocalBoards(
        this.state.cboardBoards,
        this.state.search
      );
      localPages = Math.ceil(localBoards.length / BOARDS_PAGE_LIMIT);
    }

    if (page > localPages && nextApiPage <= apiPages) {
      const { boards, totalPages } = await this.doSearch(
        selectedTabData.search,
        nextApiPage
      );

      newState = {
        ...newState,
        boards,
        totalPages
      };
    }

    this.setState(newState);
  }

  async doSearch(
    search = this.state.search,
    page = this.state.page,
    selectedTab = this.state.selectedTab
  ) {
    let boards = [];
    let totalPages = 1;
    const selectedProperty = STATE_TAB_MAP[selectedTab];
    let dataForProperty =
      page > 1 ? this.state[selectedProperty] : INITIAL_STATE;

    switch (selectedTab) {
      case TAB_INDEXES.COMMUNICATOR_BOARDS:
        totalPages = 1;
        dataForProperty = {
          ...dataForProperty,
          data: this.props.communicatorBoards
        };
        boards = dataForProperty.data;
        break;

      case TAB_INDEXES.PUBLIC_BOARDS:
        //get external boards
        const externalBoards = await API.getPublicBoards({
          limit: BOARDS_PAGE_LIMIT,
          page,
          search
        });
        //set properties
        totalPages = Math.ceil(externalBoards.total / BOARDS_PAGE_LIMIT);
        dataForProperty = {
          ...externalBoards,
          data: dataForProperty.data.concat(externalBoards.data)
        };
        boards = dataForProperty.data;
        break;

      case TAB_INDEXES.MY_BOARDS:
        const myBoardsResponse = await API.getMyBoards({
          limit: BOARDS_PAGE_LIMIT,
          page,
          search
        });
        totalPages = Math.ceil(myBoardsResponse.total / BOARDS_PAGE_LIMIT);
        dataForProperty = {
          ...myBoardsResponse,
          data: dataForProperty.data.concat(myBoardsResponse.data)
        };
        boards = dataForProperty.data;
        break;

      default:
        break;
    }

    return {
      boards,
      totalPages,
      [selectedProperty]: dataForProperty
    };
  }

  async onSearch(search = this.state.search) {
    this.setState({ search });

    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }

    this.searchTimeout = setTimeout(async () => {
      this.setState({
        boards: [],
        loading: true,
        page: 1,
        totalPages: 1
      });
      const { boards, totalPages } = await this.doSearch(search);
      this.setState({
        boards,
        page: 1,
        totalPages,
        loading: false
      });
    }, 500);
  }

  async addOrRemoveBoard(board) {
    const BOARD_ACTIONS_MAP = {
      [TAB_INDEXES.COMMUNICATOR_BOARDS]: 'communicatorBoardsAction',
      [TAB_INDEXES.PUBLIC_BOARDS]: 'copyOrRemoveAction',
      [TAB_INDEXES.MY_BOARDS]: 'addOrRemoveAction'
    };

    const action = BOARD_ACTIONS_MAP[this.state.selectedTab];
    await this[action](board);
  }

  async communicatorBoardsAction(board) {
    // If Communicator Tab is selected, the board should be removed from the Communicator
    const communicatorBoards = this.props.communicatorBoards.filter(
      cb => cb.id !== board.id
    );
    await this.updateCommunicatorBoards(communicatorBoards);
    this.setState({ boards: communicatorBoards });
  }

  async copyOrRemoveAction(board) {
    const {
      intl,
      communicatorBoards,
      showNotification,
      deleteBoardCommunicator
    } = this.props;
    // If Public Boards Tab is selected, the board should be copied/removed to/from the Communicator
    const boardIndex = communicatorBoards.findIndex(b => b.id === board.id);
    if (boardIndex >= 0) {
      deleteBoardCommunicator(board.id);
      showNotification(
        intl.formatMessage(messages.boardRemovedFromCommunicator)
      );
    } else {
    }
  }

  async addOrRemoveAction(board) {
    // If All My Boards Tab is selected, the board should be added/removed to/from the Communicator
    let communicatorBoards = [...this.props.communicatorBoards];
    const boardIndex = communicatorBoards.findIndex(b => b.id === board.id);
    if (boardIndex >= 0) {
      communicatorBoards.splice(boardIndex, 1);
      this.props.showNotification(
        this.props.intl.formatMessage(messages.boardRemovedFromCommunicator)
      );
    } else {
      communicatorBoards.push(board);
      this.props.showNotification(
        this.props.intl.formatMessage(messages.boardAddedToCommunicator)
      );
    }

    await this.updateCommunicatorBoards(communicatorBoards);

    // Need to fetch board if its not locally available
    if (
      boardIndex < 0 &&
      this.props.availableBoards.findIndex(b => b.id === board.id) < 0
    ) {
      let boards = [];
      try {
        const boardData = await API.getBoard(board.id);
        boards.push(boardData);
      } catch (e) {}
      this.props.addBoards(boards);
    }
  }

  async updateCommunicatorBoards(boards) {
    const {
      userData,
      communicators,
      currentCommunicator,
      changeCommunicator,
      editCommunicator
    } = this.props;

    const updatedCommunicatorData = {
      ...currentCommunicator,
      boards: boards.map(cb => cb.id)
    };

    if (communicators.findIndex(c => c.id === currentCommunicator.id) >= 0) {
      editCommunicator(updatedCommunicatorData);
      changeCommunicator(updatedCommunicatorData.id);

      // Loggedin user?
      if ('name' in userData && 'email' in userData) {
        try {
          await API.updateCommunicator(updatedCommunicatorData);
        } catch (err) {}
      }
    }
  }

  async publishBoard(board) {
    const { userData, replaceBoard, showNotification, intl } = this.props;
    const boardData = {
      ...board,
      isPublic: !board.isPublic
    };
    const sBoards = this.state.boards;
    const index = sBoards.findIndex(b => board.id === b.id);
    sBoards.splice(index, 1, boardData);
    replaceBoard(board, boardData);
    this.setState({
      boards: sBoards
    });
    boardData.isPublic
      ? showNotification(intl.formatMessage(messages.boardPublished))
      : showNotification(intl.formatMessage(messages.boardUnpublished));

    // Loggedin user?
    if ('name' in userData && 'email' in userData) {
      try {
        const boardResponse = await API.updateBoard(boardData);
        replaceBoard(boardData, boardResponse);
      } catch (err) {}
    }
  }

  async setRootBoard(board) {
    const {
      userData,
      communicators,
      currentCommunicator,
      changeCommunicator,
      editCommunicator
    } = this.props;

    const updatedCommunicatorData = {
      ...currentCommunicator,
      rootBoard: board.id
    };

    if (communicators.findIndex(c => c.id === currentCommunicator.id) >= 0) {
      editCommunicator(updatedCommunicatorData);
      changeCommunicator(updatedCommunicatorData.id);

      // Loggedin user?
      if ('name' in userData && 'email' in userData) {
        try {
          await API.updateCommunicator(updatedCommunicatorData);
        } catch (err) {}
      }
    }
  }

  openSearchBar() {
    this.setState({ isSearchOpen: true });
  }

  async deleteMyBoard(board) {
    const {
      showNotification,
      deleteBoard,
      communicators,
      editCommunicator,
      deleteApiBoard,
      userData,
      intl
    } = this.props;
    deleteBoard(board.id);

    // Loggedin user?
    if ('name' in userData && 'email' in userData) {
      try {
        await deleteApiBoard(board.id);
      } catch (err) {}
    }
    communicators.forEach(async comm => {
      if (comm.boards.includes(board.id)) {
        editCommunicator({
          ...comm,
          boards: comm.boards.filter(b => b !== board.id)
        });

        // Loggedin user?
        if ('name' in userData && 'email' in userData) {
          try {
            await API.updateCommunicator(comm);
          } catch (err) {}
        }
      }
    });
    const sBoards = this.state.boards;
    const index = sBoards.findIndex(b => board.id === b.id);
    sBoards.splice(index, 1);
    this.setState({
      boards: sBoards
    });
    showNotification(intl.formatMessage(messages.boardDeleted));
  }

  render() {
    const limit = this.state.page * BOARDS_PAGE_LIMIT;
    const communicatorBoardsIds = this.props.communicatorBoards.map(b => b.id);
    const dialogProps = {
      ...this.props,
      ...this.state,
      limit,
      communicator: this.props.currentCommunicator,
      communicatorBoardsIds,
      addOrRemoveBoard: this.addOrRemoveBoard.bind(this),
      deleteMyBoard: this.deleteMyBoard.bind(this),
      publishBoard: this.publishBoard.bind(this),
      setRootBoard: this.setRootBoard.bind(this),
      loadNextPage: this.loadNextPage.bind(this),
      onTabChange: this.onTabChange.bind(this),
      onSearch: this.onSearch.bind(this),
      openSearchBar: this.openSearchBar.bind(this)
    };

    return <CommunicatorDialog {...dialogProps} />;
  }
}

const mapStateToProps = ({ board, communicator, language, app }, ownProps) => {
  const activeCommunicatorId = communicator.activeCommunicatorId;
  const currentCommunicator = communicator.communicators.find(
    communicator => communicator.id === activeCommunicatorId
  );

  const communicatorBoards = board.boards.filter(
    board => currentCommunicator.boards.indexOf(board.id) >= 0
  );

  const { userData } = app;
  const cboardBoards = board.boards.filter(
    board => board.email === 'support@cboard.io'
  );

  return {
    ...ownProps,
    communicators: communicator.communicators,
    currentCommunicator,
    communicatorBoards,
    cboardBoards,
    availableBoards: board.boards,
    userData
  };
};

const mapDispatchToProps = {
  createCommunicator,
  editCommunicator,
  changeCommunicator,
  addBoards,
  replaceBoard,
  showNotification,
  deleteBoard,
  deleteApiBoard,
  deleteBoardCommunicator
};

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(injectIntl(CommunicatorDialogContainer));
