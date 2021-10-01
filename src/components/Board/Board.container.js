import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import shortid from 'shortid';
import { resize } from 'mathjs';
import { isEqual } from 'lodash';
import { injectIntl, intlShape } from 'react-intl';
import isMobile from 'ismobilejs';
import domtoimage from 'dom-to-image';
import CircularProgress from '@material-ui/core/CircularProgress';
import Button from '@material-ui/core/Button';
import Dialog from '@material-ui/core/Dialog';
import DialogActions from '@material-ui/core/DialogActions';
import DialogContent from '@material-ui/core/DialogContent';
import DialogContentText from '@material-ui/core/DialogContentText';
import DialogTitle from '@material-ui/core/DialogTitle';
import Slide from '@material-ui/core/Slide';
import {
  showNotification,
  hideNotification
} from '../Notifications/Notifications.actions';
import { deactivateScanner } from '../../providers/ScannerProvider/ScannerProvider.actions';
import {
  speak,
  cancelSpeech
} from '../../providers/SpeechProvider/SpeechProvider.actions';
import { moveOrderItem } from '../FixedGrid/utils';
import {
  addBoards,
  changeBoard,
  replaceBoard,
  previousBoard,
  toRootBoard,
  createBoard,
  updateBoard,
  switchBoard,
  createTile,
  deleteTiles,
  editTiles,
  focusTile,
  clickSymbol,
  changeOutput,
  historyRemoveBoard,
  updateApiObjects,
  updateApiObjectsNoChild,
  getApiObjects,
  downloadImages
} from './Board.actions';
import {
  upsertCommunicator,
  changeCommunicator,
  addBoardCommunicator
} from '../Communicator/Communicator.actions';
import { disableTour } from '../App/App.actions';
import TileEditor from './TileEditor';
import messages from './Board.messages';
import Board from './Board.component';
import API from '../../api';
import {
  SCANNING_METHOD_AUTOMATIC,
  SCANNING_METHOD_MANUAL
} from '../Settings/Scanning/Scanning.constants';
import { NOTIFICATION_DELAY } from '../Notifications/Notifications.constants';
import { isAndroid } from '../../cordova-util';
import { EMPTY_VOICES } from '../../providers/SpeechProvider/SpeechProvider.constants';
import { DEFAULT_ROWS_NUMBER, DEFAULT_COLUMNS_NUMBER } from './Board.constants';

const Transition = React.forwardRef(function Transition(props, ref) {
  return <Slide direction="up" ref={ref} {...props} />;
});

export class BoardContainer extends Component {
  static propTypes = {
    /**
     * @ignore
     */
    intl: intlShape.isRequired,
    /**
     * Board history navigation stack
     */
    navHistory: PropTypes.arrayOf(PropTypes.string),
    /**
     * Board to display
     */
    board: PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string,
      tiles: PropTypes.arrayOf(PropTypes.object)
    }),
    /**
     * Board output
     */
    output: PropTypes.arrayOf(
      PropTypes.shape({
        label: PropTypes.string,
        image: PropTypes.string,
        vocalization: PropTypes.string
      })
    ),
    /**
     * Add boards from API
     */
    addBoards: PropTypes.func,
    /**
     * Load board
     */
    changeBoard: PropTypes.func,
    /**
     * Load previous board
     */
    previousBoard: PropTypes.func,
    /**
     * Load root board
     */
    toRootBoard: PropTypes.func,
    historyRemoveBoard: PropTypes.func,
    /**
     * Create board
     */
    createBoard: PropTypes.func,
    updateBoard: PropTypes.func,
    /**
     * Create tile
     */
    createTile: PropTypes.func,
    /**
     * Edit tiles
     */
    editTiles: PropTypes.func,
    /**
     * Delete tiles
     */
    deleteTiles: PropTypes.func,
    /**
     * Focuses a board tile
     */
    focusTile: PropTypes.func,
    /**
     * Change output
     */
    changeOutput: PropTypes.func,
    /**
     * Show notification
     */
    showNotification: PropTypes.func,
    /**
     * Deactivate Scanner
     */
    deactivateScanner: PropTypes.func,
    /**
     * Show display Settings
     */
    displaySettings: PropTypes.object,
    /**
     * Show navigationSettings
     */
    navigationSettings: PropTypes.object,
    /**
     * Show userData
     */
    userData: PropTypes.object,
    /**
     * Scanner Settings
     */
    scannerSettings: PropTypes.object,
    /**
     * Adds a Board to the Active Communicator
     */
    addBoardCommunicator: PropTypes.func.isRequired,
    downloadImages: PropTypes.func,
    lang: PropTypes.string,
    isRootBoardTourEnabled: PropTypes.bool,
    disableTour: PropTypes.func
  };

  state = {
    selectedTileIds: [],
    isSaving: false,
    isSelectAll: false,
    isSelecting: false,
    isLocked: true,
    tileEditorOpen: false,
    translatedBoard: null,
    isGettingApiObjects: false,
    copyPublicBoard: false,
    blockedPrivateBoard: false,
    isFixedBoard: false,
    copiedTiles: [],
    copiedTilesBoardId: null
  };

  async componentDidMount() {
    const {
      match: {
        params: { id }
      }
    } = this.props;

    const {
      board,
      boards,
      communicator,
      changeBoard,
      userData,
      history,
      getApiObjects,
      downloadImages
    } = this.props;

    // Loggedin user?
    if ('name' in userData && 'email' in userData && window.navigator.onLine) {
      //synchronize user id in analytics
      window.gtag('set', { user_id: userData.id });
      //synchronize communicator and boards with API
      this.setState({ isGettingApiObjects: true });
      await getApiObjects();
      this.setState({ isGettingApiObjects: false });
    }

    let boardExists = null;

    if (id && board && id === board.id) {
      //active board = requested board, use that board
      boardExists = boards.find(b => b.id === board.id);
    } else if (id && board && id !== board.id) {
      //active board != requested board, use requested if exist otherwise use active
      boardExists = boards.find(b => b.id === id);
      if (!boardExists) {
        try {
          const remoteBoard = await this.tryRemoteBoard(id);
          if (remoteBoard) {
            boardExists = remoteBoard;
          } else {
            boardExists = boards.find(b => b.id === board.id);
          }
        } catch (err) {
          boardExists = boards.find(b => b.id === board.id);
        }
      }
    } else if (id && !board) {
      //no active board but requested board, use requested
      boardExists = boards.find(b => b.id === id);
      if (!boardExists) {
        try {
          boardExists = await this.tryRemoteBoard(id);
        } catch (err) {
          boardExists = null;
        }
      }
    } else if (!id && !!board) {
      //no requested board, use active board
      boardExists = boards.find(b => b.id === board.id);
    } else {
      //neither requested nor active board, use communicator root board
      boardExists = boards.find(b => b.id === communicator.rootBoard);
    }

    if (!boardExists) {
      // try the root board
      boardExists = boards.find(b => b.id === communicator.rootBoard);
      if (!boardExists) {
        boardExists = boards.find(b => b.id !== '');
      }
    }
    const boardId = boardExists.id;
    changeBoard(boardId);
    const goTo = id ? boardId : `board/${boardId}`;
    history.replace(goTo);

    const translatedBoard = this.translateBoard(boardExists);
    this.setState({ translatedBoard });

    //set board type
    this.setState({ isFixedBoard: !!boardExists.isFixed });

    if (isAndroid()) downloadImages();
  }

  UNSAFE_componentWillReceiveProps(nextProps) {
    if (this.props.match.params.id !== nextProps.match.params.id) {
      const {
        navHistory,
        boards,
        changeBoard,
        previousBoard,
        historyRemoveBoard
      } = this.props;

      const boardExists = boards.find(b => b.id === nextProps.match.params.id);
      if (boardExists) {
        // Was a browser back action?
        if (
          navHistory.length >= 2 &&
          nextProps.match.params.id === navHistory[navHistory.length - 2]
        ) {
          changeBoard(nextProps.match.params.id);
          previousBoard();
        }
      } else {
        // Was a browser back action?
        if (
          navHistory.length >= 2 &&
          nextProps.match.params.id === navHistory[navHistory.length - 2]
        ) {
          //board is invalid so we remove from navigation history
          historyRemoveBoard(nextProps.match.params.id);
        }
      }
    }

    // TODO: perf issues
    const translatedBoard = this.translateBoard(nextProps.board);
    this.setState({ translatedBoard });
  }

  componentDidUpdate(prevProps) {
    const { board } = this.props;
    if (board && prevProps.board && board.isFixed !== prevProps.board.isFixed) {
      this.setState({ isFixedBoard: board.isFixed });
    }
  }

  toggleSelectMode() {
    this.setState(prevState => ({
      isSelecting: !prevState.isSelecting,
      isSelectAll: false,
      selectedTileIds: []
    }));
  }

  selectAllTiles() {
    const { board } = this.props;
    const allTileIds = board.tiles.map(tile => tile.id);

    this.setState({
      selectedTileIds: allTileIds
    });
  }

  selectTile(tileId) {
    this.setState({
      selectedTileIds: [...this.state.selectedTileIds, tileId]
    });
  }

  deselectTile(tileId) {
    const [...selectedTileIds] = this.state.selectedTileIds;
    const tileIndex = selectedTileIds.indexOf(tileId);
    selectedTileIds.splice(tileIndex, 1);
    this.setState({ selectedTileIds });
  }

  toggleTileSelect(tileId) {
    if (this.state.selectedTileIds.includes(tileId)) {
      this.deselectTile(tileId);
    } else {
      this.selectTile(tileId);
    }
  }

  async tryRemoteBoard(boardId) {
    const { userData } = this.props;
    const remoteBoard = await API.getBoard(boardId);
    //if requested board is from the user just add it
    if (
      'name' in userData &&
      'email' in userData &&
      remoteBoard.email === userData.email &&
      remoteBoard.author === userData.name
    ) {
      return remoteBoard;
    } else {
      //if requested board is public, ask about copy it
      if (remoteBoard.isPublic) {
        this.setState({ copyPublicBoard: remoteBoard });
      } else {
        this.setState({ blockedPrivateBoard: true });
      }
    }
    return null;
  }

  translateBoard(board) {
    if (!board) {
      return null;
    }

    const { intl } = this.props;
    let name;
    let nameFromKey;
    if (board.nameKey) {
      const nameKeyArray = board.nameKey.split('.');
      nameFromKey = nameKeyArray[nameKeyArray.length - 1];
    }
    if (board.nameKey && !board.name) {
      name = intl.formatMessage({ id: board.nameKey });
    } else if (
      board.nameKey &&
      board.name &&
      nameFromKey === board.name &&
      intl.messages[board.nameKey]
    ) {
      name = intl.formatMessage({ id: board.nameKey });
    } else {
      name = board.name;
    }
    const validTiles = board.tiles.filter(tile => (tile ? true : false));
    const tiles = validTiles.map(tile => ({
      ...tile,
      label:
        tile.labelKey && intl.messages[tile.labelKey]
          ? intl.formatMessage({ id: tile.labelKey })
          : tile.label
    }));

    const translatedBoard = {
      ...board,
      name,
      tiles
    };

    return translatedBoard;
  }

  async captureBoardScreenshot() {
    const node = document.getElementById('BoardTilesContainer').firstChild;
    let dataURL = null;
    try {
      dataURL = await domtoimage.toPng(node);
    } catch (e) {}

    return dataURL;
  }

  async updateBoardScreenshot() {
    let url = null;
    const dataURL = await this.captureBoardScreenshot();
    if (dataURL && dataURL !== 'data:,') {
      const filename = `${this.state.translatedBoard.name ||
        this.state.translatedBoard.id}.png`;
      url = await API.uploadFromDataURL(dataURL, filename);
    }

    return url;
  }

  playAudio(src) {
    let audio = new Audio();
    audio.src = src;
    audio.play();
  }

  handleEditBoardTitle = name => {
    const { board, updateBoard } = this.props;
    const titledBoard = {
      ...board,
      name: name
    };
    const processedBoard = this.updateIfFeaturedBoard(titledBoard);
    updateBoard(processedBoard);
    this.saveApiBoardOperation(processedBoard);
  };

  saveApiBoardOperation = async board => {
    const {
      userData,
      communicator,
      upsertCommunicator,
      changeCommunicator,
      replaceBoard,
      updateApiObjectsNoChild,
      lang
    } = this.props;

    var createCommunicator = false;
    var createBoard = false;
    // Loggedin user?
    if ('name' in userData && 'email' in userData) {
      this.setState({ isSaving: true });
      try {
        //prepare board
        let boardData = {
          ...board,
          author: userData.name,
          email: userData.email,
          hidden: false,
          locale: lang
        };
        //check if user has an own communicator
        let communicatorData = { ...communicator };
        if (communicator.email !== userData.email) {
          //need to create a new communicator
          communicatorData = {
            ...communicator,
            author: userData.name,
            email: userData.email,
            boards: boardData.id === 'root' ? ['root'] : ['root', boardData.id],
            rootBoard: 'root',
            id: shortid.generate()
          };
          upsertCommunicator(communicatorData);
          changeCommunicator(communicatorData.id);
          createCommunicator = true;
        }
        //check if we have to create a copy of the board
        if (boardData.id.length < 14) {
          createBoard = true;
          boardData = {
            ...boardData,
            isPublic: false
          };
        } else {
          //update the board
          updateBoard(boardData);
        }
        //api updates
        updateApiObjectsNoChild(boardData, createCommunicator, createBoard)
          .then(boardId => {
            if (createBoard) {
              replaceBoard({ ...boardData }, { ...boardData, id: boardId });
            }
            this.props.history.replace(`/board/${boardId}`);
          })
          .catch(err => {
            console.log(err.message);
          });
      } catch (err) {
        console.log(err.message);
      } finally {
        this.setState({ isSaving: false });
      }
    }
  };

  handleEditClick = () => {
    this.setState({ tileEditorOpen: true });
  };

  handleBoardTypeChange = async () => {
    const { board, updateBoard } = this.props;

    this.setState({ isFixedBoard: !this.state.isFixedBoard });
    const newBoard = {
      ...board,
      isFixed: !this.state.isFixedBoard
    };
    if (!board.grid) {
      const defaultGrid = {
        rows: DEFAULT_ROWS_NUMBER,
        columns: DEFAULT_COLUMNS_NUMBER,
        order: this.getDefaultOrdering(board.tiles)
      };
      newBoard.grid = defaultGrid;
    }
    const processedBoard = this.updateIfFeaturedBoard(newBoard);
    await updateBoard(processedBoard);
    this.saveApiBoardOperation(processedBoard);
  };

  getDefaultOrdering = tiles => {
    let order = [];
    let tilesIndex = 0;
    for (var i = 0; i < DEFAULT_ROWS_NUMBER; i++) {
      order[i] = [];
      for (var j = 0; j < DEFAULT_COLUMNS_NUMBER; j++) {
        if (tilesIndex < tiles.length && tiles[tilesIndex]) {
          order[i][j] = tiles[tilesIndex].id;
        } else {
          order[i][j] = null;
        }
        tilesIndex++;
      }
    }
    return order;
  };

  handleTileEditorCancel = () => {
    this.setState({ tileEditorOpen: false });
  };

  handleEditTileEditorSubmit = tiles => {
    const { board, editTiles, userData } = this.props;
    this.updateIfFeaturedBoard(board);
    editTiles(tiles, board.id);

    // Loggedin user?
    if ('name' in userData && 'email' in userData) {
      this.handleApiUpdates(null, null, tiles);
    }
    this.toggleSelectMode();
  };

  handleAddTileEditorSubmit = async tile => {
    const {
      userData,
      createTile,
      board,
      createBoard,
      switchBoard,
      addBoardCommunicator,
      history
    } = this.props;
    const boardData = {
      id: tile.loadBoard,
      name: tile.label,
      nameKey: tile.labelKey,
      hidden: false,
      tiles: [],
      isPublic: false,
      email: userData.email ? userData.email : board.email,
      author: userData.name ? userData.name : board.author
    };
    if (tile.loadBoard && !tile.linkedBoard) {
      console.log('aca crea el board');
      createBoard(boardData);
      addBoardCommunicator(boardData.id);
    }
    // Loggedin user?
    if ('name' in userData && 'email' in userData) {
      await this.handleApiUpdates(tile);
      return;
    }
    if (tile.type !== 'board') {
      console.log('Crear tile', tile);
      this.updateIfFeaturedBoard(board);
      createTile(tile, board.id);
    }

    //if not and is adding an emptyBoard
    if (tile.type === 'board') {
      switchBoard(boardData.id);
      history.replace(`/board/${boardData.id}`, []);
    }
  };

  updateIfFeaturedBoard = board => {
    const { userData, updateBoard, intl, lang } = this.props;
    let boardData = {
      ...board
    };
    if (
      'name' in userData &&
      'email' in userData &&
      board.email !== userData.email
    ) {
      boardData = {
        ...boardData,
        name:
          board.name ||
          this.nameFromKey(board) ||
          intl.formatMessage(messages.myBoardTitle),
        author: userData.name,
        email: userData.email,
        hidden: false,
        isPublic: false,
        locale: lang
      };
      updateBoard(boardData);
    }
    return boardData;
  };

  nameFromKey = board => {
    let nameFromKey = undefined;
    if (board.nameKey) {
      const nameKeyArray = board.nameKey.split('.');
      nameFromKey = nameKeyArray[nameKeyArray.length - 1];
    }
    return nameFromKey;
  };

  handleAddClick = () => {
    this.setState({
      tileEditorOpen: true,
      selectedTileIds: [],
      isSelecting: false
    });
  };

  handleAddRemoveRow = async (isAdd, isLeftOrTop) => {
    const { board, updateBoard } = this.props;
    if ((!isAdd && board.grid.rows > 1) || (isAdd && board.grid.rows < 12)) {
      let newOrder = [];
      const newRows = isAdd ? board.grid.rows + 1 : board.grid.rows - 1;
      if (Array.isArray(board.grid.order) && board.grid.order.length) {
        newOrder = resize(
          board.grid.order,
          [newRows, board.grid.columns],
          null
        );
      } else {
        newOrder = this.getDefaultOrdering(board.tiles);
      }
      const newBoard = {
        ...board,
        grid: {
          ...board.grid,
          rows: newRows,
          order: newOrder
        }
      };
      const processedBoard = this.updateIfFeaturedBoard(newBoard);
      updateBoard(processedBoard);
      this.saveApiBoardOperation(processedBoard);
    }
  };

  handleAddRemoveColumn = async (isAdd, isLeftOrTop) => {
    const { board, updateBoard } = this.props;
    if (
      (!isAdd && board.grid.columns > 1) ||
      (isAdd && board.grid.columns < 12)
    ) {
      let newOrder = [];
      const newColumns = isAdd
        ? board.grid.columns + 1
        : board.grid.columns - 1;
      if (Array.isArray(board.grid.order) && board.grid.order.length) {
        newOrder = resize(
          board.grid.order,
          [board.grid.rows, newColumns],
          null
        );
      } else {
        newOrder = this.getDefaultOrdering(board.tiles);
      }
      const newBoard = {
        ...board,
        grid: {
          ...board.grid,
          columns: newColumns,
          order: newOrder
        }
      };
      const processedBoard = this.updateIfFeaturedBoard(newBoard);
      updateBoard(processedBoard);
      this.saveApiBoardOperation(processedBoard);
    }
  };

  handleLayoutChange = (currentLayout, layouts) => {
    const { updateBoard, replaceBoard, board } = this.props;
    currentLayout.sort((a, b) => {
      if (a.y === b.y) {
        return a.x - b.x;
      } else if (a.y > b.y) {
        return 1;
      }
      return -1;
    });

    const tilesIds = currentLayout.map(gridTile => gridTile.i);
    const tiles = tilesIds.map(t => {
      return board.tiles.find(
        tile => tile.id === t || Number(tile.id) === Number(t)
      );
    });
    const newBoard = { ...board, tiles };
    replaceBoard(board, newBoard);
    if (!isEqual(board.tiles, tiles)) {
      const processedBoard = this.updateIfFeaturedBoard(newBoard);
      updateBoard(processedBoard);
      this.saveApiBoardOperation(processedBoard);
    }
  };

  handleTileDrop = async (tile, position) => {
    const { board, updateBoard } = this.props;
    const newOrder = moveOrderItem(tile.id, position, board.grid.order);

    const newBoard = {
      ...board,
      grid: {
        ...board.grid,
        order: newOrder
      }
    };
    const processedBoard = this.updateIfFeaturedBoard(newBoard);
    updateBoard(processedBoard);
    this.saveApiBoardOperation(processedBoard);
  };

  handleLockClick = () => {
    this.setState((state, props) => ({
      isLocked: !state.isLocked,
      isSaving: false,
      isSelecting: false,
      selectedTileIds: []
    }));
  };

  handleSelectClick = () => {
    this.toggleSelectMode();
  };

  handleSelectAllToggle = () => {
    if (this.state.isSelectAll) {
      this.setState({ selectedTileIds: [] });
    } else {
      this.selectAllTiles();
    }

    this.setState(prevState => ({
      isSelectAll: !prevState.isSelectAll
    }));
  };

  handleTileClick = tile => {
    if (this.state.isSelecting) {
      this.toggleTileSelect(tile.id);
      return;
    }

    const {
      changeBoard,
      changeOutput,
      clickSymbol,
      speak,
      intl,
      boards,
      showNotification,
      navigationSettings
    } = this.props;
    const hasAction = tile.action && tile.action.startsWith('+');

    const say = () => {
      if (tile.sound) {
        this.playAudio(tile.sound);
      } else {
        const toSpeak = !hasAction ? tile.vocalization || tile.label : null;
        if (toSpeak) {
          speak(toSpeak);
        }
      }
    };

    if (tile.loadBoard) {
      const nextBoard =
        boards.find(b => b.id === tile.loadBoard) ||
        // If the board id is invalid, try falling back to a board
        // with the right name.
        boards.find(b => b.name === tile.label);
      if (nextBoard) {
        changeBoard(nextBoard.id);
        this.props.history.push(nextBoard.id);
        if (navigationSettings.vocalizeFolders) {
          say();
        }
      } else {
        showNotification(intl.formatMessage(messages.boardMissed));
      }
    } else {
      changeOutput([...this.props.output, tile]);
      clickSymbol(tile.label);
      say();
    }
  };

  handleAddTile = (tile, boardId) => {
    const { intl, createTile, showNotification } = this.props;
    createTile(tile, boardId);
    showNotification(intl.formatMessage(messages.tilesCreated));
  };

  handleDeleteClick = () => {
    const { intl, deleteTiles, showNotification, board, userData } = this.props;
    this.updateIfFeaturedBoard(board);
    deleteTiles(this.state.selectedTileIds, board.id);

    // Loggedin user?
    if ('name' in userData && 'email' in userData) {
      this.handleApiUpdates(null, this.state.selectedTileIds, null);
    }

    this.setState({
      selectedTileIds: []
    });
    showNotification(intl.formatMessage(messages.tilesDeleted));
    this.toggleSelectMode();
  };

  handleLockNotify = countdown => {
    const { intl, showNotification, hideNotification } = this.props;

    if (countdown > 3) {
      return;
    }

    if (!countdown) {
      hideNotification();
      return;
    }

    const clicksToUnlock = `${countdown} ${intl.formatMessage(
      messages.clicksToUnlock
    )}`;

    hideNotification();
    // HACK: refactor Notification container
    setTimeout(() => {
      showNotification(clicksToUnlock);
    });
  };

  handleScannerStrategyNotification = () => {
    const {
      scannerSettings: { strategy },
      showNotification,
      intl
    } = this.props;
    const messagesKeyMap = {
      [SCANNING_METHOD_MANUAL]: messages.scannerManualStrategy,
      [SCANNING_METHOD_AUTOMATIC]: messages.scannerAutomaticStrategy
    };
    showNotification(intl.formatMessage(messagesKeyMap[strategy]));

    if (!isMobile.any) {
      setTimeout(() => {
        showNotification(intl.formatMessage(messages.scannerHowToDeactivate));
      }, NOTIFICATION_DELAY);
    }
  };

  async uploadTileSound(tile) {
    if (tile && tile.sound && tile.sound.startsWith('data')) {
      const { userData } = this.props;
      try {
        var blob = new Blob([this.convertDataURIToBinary(tile.sound)], {
          type: 'audio/ogg; codecs=opus'
        });
        const audioUrl = await API.uploadFile(blob, userData.email + '.ogg');
        tile.sound = audioUrl;
      } catch (err) {
        console.log(err.message);
      }
    }
    return tile;
  }

  convertDataURIToBinary(dataURI) {
    var BASE64_MARKER = ';base64,';
    var base64Index = dataURI.indexOf(BASE64_MARKER) + BASE64_MARKER.length;
    var base64 = dataURI.substring(base64Index);
    var raw = window.atob(base64);
    var rawLength = raw.length;
    var array = new Uint8Array(new ArrayBuffer(rawLength));

    for (let i = 0; i < rawLength; i++) {
      array[i] = raw.charCodeAt(i);
    }
    return array;
  }

  handleApiUpdates = async (
    tile = null,
    deletedTilesiIds = null,
    editedTiles = null,
    processedBoard = null
  ) => {
    const {
      userData,
      communicator,
      board,
      intl,
      upsertCommunicator,
      changeCommunicator,
      updateApiObjectsNoChild,
      updateApiObjects,
      replaceBoard,
      updateBoard,
      switchBoard,
      lang
    } = this.props;

    // Loggedin user?
    if ('name' in userData && 'email' in userData) {
      this.setState({
        isSaving: true
      });

      if (tile && tile.sound && tile.sound.startsWith('data')) {
        tile = await this.uploadTileSound(tile);
      }
      if (editedTiles) {
        let _editedTiles = [];
        for (let _tile of editedTiles) {
          _editedTiles.push(await this.uploadTileSound(_tile));
        }
        editedTiles = _editedTiles;
      }

      var createCommunicator = false;
      var createParentBoard = false;
      var createChildBoard = false;
      var childBoardData = null;

      let uTiles = [];
      if (deletedTilesiIds) {
        uTiles = board.tiles.filter(
          cTile => !deletedTilesiIds.includes(cTile.id)
        );
      }
      if (editedTiles) {
        uTiles = board.tiles.map(
          cTile => editedTiles.find(s => s.id === cTile.id) || cTile
        );
      }
      if (tile && tile.type !== 'board') {
        uTiles = [...board.tiles, tile];
      }
      if (tile && tile.type === 'board') {
        uTiles = [...board.tiles];
      }

      let parentBoardData = processedBoard
        ? processedBoard
        : {
            ...board,
            name:
              board.name ||
              this.nameFromKey(board) ||
              intl.formatMessage(messages.myBoardTitle),
            tiles: uTiles,
            author: userData.name,
            email: userData.email,
            hidden: false,
            locale: lang
          };
      //check if user has an own communicator
      let communicatorData = { ...communicator };
      if (communicator.email !== userData.email) {
        //need to create a new communicator
        communicatorData = {
          ...communicator,
          author: userData.name,
          email: userData.email,
          id: shortid.generate()
        };
        upsertCommunicator(communicatorData);
        changeCommunicator(communicatorData.id);
        createCommunicator = true;
      }
      //check for a new  own board
      if (tile && tile.loadBoard && !tile.linkedBoard) {
        const boardData = {
          id: tile.loadBoard,
          name: tile.label,
          nameKey: tile.labelKey,
          hidden: false,
          tiles: [],
          isPublic: false,
          author: userData.name,
          email: userData.email,
          locale: lang,
          caption: tile.image
        };
        childBoardData = { ...boardData };
        createChildBoard = true;
        updateBoard(childBoardData);
      }
      //check if we have to create a copy of the parent
      if (parentBoardData.id.length < 14) {
        createParentBoard = true;
        parentBoardData = {
          ...parentBoardData,
          isPublic: false
        };
      } else {
        //update the parent
        updateBoard(parentBoardData);
      }
      //api updates
      if (tile && tile.type === 'board') {
        //child becomes parent
        updateApiObjectsNoChild(childBoardData, createCommunicator, true)
          .then(parentBoardId => {
            switchBoard(parentBoardId);
            this.props.history.replace(`/board/${parentBoardId}`, []);
            this.setState({ isSaving: false });
          })
          .catch(e => {
            this.setState({ isSaving: false });
          });
      } else {
        if (!createChildBoard) {
          updateApiObjectsNoChild(
            parentBoardData,
            createCommunicator,
            createParentBoard
          )
            .then(parentBoardId => {
              if (createParentBoard) {
                replaceBoard(
                  { ...parentBoardData },
                  { ...parentBoardData, id: parentBoardId }
                );
              }
              this.props.history.replace(`/board/${parentBoardId}`);
              this.setState({ isSaving: false });
            })
            .catch(e => {
              this.setState({ isSaving: false });
            });
        } else {
          updateApiObjects(
            childBoardData,
            parentBoardData,
            createCommunicator,
            createParentBoard
          )
            .then(parentBoardId => {
              if (createParentBoard) {
                replaceBoard(
                  { ...parentBoardData },
                  { ...parentBoardData, id: parentBoardId }
                );
              }
              this.props.history.replace(`/board/${parentBoardId}`);
              this.setState({ isSaving: false });
            })
            .catch(e => {
              this.setState({ isSaving: false });
            });
        }
      }
    }
  };

  onRequestPreviousBoard() {
    if (this.props.navHistory.length >= 2) {
      const prevBoardId = this.props.navHistory[
        this.props.navHistory.length - 2
      ];
      this.props.history.replace(`/board/${prevBoardId}`);
    }
  }

  handleCopyRemoteBoard = async () => {
    const { intl, showNotification } = this.props;
    try {
      await this.createBoardsRecursively(this.state.copyPublicBoard);
      showNotification(intl.formatMessage(messages.boardCopiedSuccessfully));
    } catch (err) {
      console.log(err.message);
      showNotification(intl.formatMessage(messages.boardCopyError));
    }
  };
  async createBoardsRecursively(board, records) {
    const {
      createBoard,
      switchBoard,
      addBoardCommunicator,
      upsertCommunicator,
      changeCommunicator,
      history,
      communicator,
      userData,
      updateApiObjectsNoChild,
      boards,
      intl
    } = this.props;

    //prevent shit
    if (!board) {
      return;
    }
    if (records) {
      //get the list of next boards in records
      let nextBoardsRecords = records.map(entry => entry.next);
      if (nextBoardsRecords.includes(board.id)) {
        return;
      }
    }

    let newBoard = {
      ...board,
      isPublic: false,
      id: shortid.generate(),
      hidden: false,
      author: '',
      email: ''
    };
    if (!newBoard.name) {
      newBoard.name = newBoard.nameKey
        ? intl.formatMessage({ id: newBoard.nameKey })
        : intl.formatMessage(messages.noTitle);
    }
    if ('name' in userData && 'email' in userData) {
      newBoard = {
        ...newBoard,
        author: userData.name,
        email: userData.email
      };
    }
    createBoard(newBoard);
    if (!records) {
      addBoardCommunicator(newBoard.id);
    }

    // Loggedin user?
    if ('name' in userData && 'email' in userData) {
      this.setState({
        isSaving: true
      });
      let createCommunicator = false;
      if (communicator.email !== userData.email) {
        //need to create a new communicator
        const communicatorData = {
          ...communicator,
          author: userData.name,
          email: userData.email,
          id: shortid.generate()
        };
        upsertCommunicator(communicatorData);
        changeCommunicator(communicatorData.id);
        createCommunicator = true;
      }
      try {
        const boardId = await updateApiObjectsNoChild(
          newBoard,
          createCommunicator,
          true
        );
        newBoard = {
          ...newBoard,
          id: boardId
        };
      } catch (err) {
        console.log(err.message);
      }
    }
    if (!records) {
      records = [{ prev: board.id, next: newBoard.id }];
      switchBoard(newBoard.id);
      history.replace(`/board/${newBoard.id}`, []);
      const translatedBoard = this.translateBoard(newBoard);
      this.setState({
        translatedBoard,
        isSaving: false,
        copyPublicBoard: false,
        blockedPrivateBoard: false
      });
    } else {
      records.push({ prev: board.id, next: newBoard.id });
    }
    this.updateBoardReferences(board, newBoard, records);

    if (board.tiles.length < 1) {
      return;
    }

    //return condition
    board.tiles.forEach(async tile => {
      if (tile.loadBoard) {
        try {
          const nextBoard = await API.getBoard(tile.loadBoard);
          this.createBoardsRecursively(nextBoard, records);
        } catch (err) {
          if (err.response.status === 404) {
            //look for this board in available boards
            const localBoard = boards.find(b => b.id === tile.loadBoard);
            if (localBoard) {
              this.createBoardsRecursively(localBoard, records);
            }
          }
        }
      }
    });
  }

  updateBoardReferences(board, newBoard, records) {
    const { boards, updateBoard } = this.props;
    //get the list of prev boards in records, but remove the current board
    let prevBoardsRecords = records.map(entry => entry.prev);
    prevBoardsRecords = prevBoardsRecords.filter(id => id !== newBoard.id);
    let nextBoardsRecords = records.map(entry => entry.next);
    //look for reference to the original board id
    boards.forEach(b => {
      b.tiles.forEach((tile, index) => {
        // if (
        //   //general case: tile can contains reference to the board
        //   tile &&
        //   tile.loadBoard &&
        //   tile.loadBoard === board.id
        // ) {
        //   b.tiles.splice(index, 1, {
        //     ...tile,
        //     loadBoard: newBoard.id
        //   });
        //   try {
        //     updateBoard(b);
        //   } catch (err) {
        //     console.log(err.message);
        //   }
        // }
        // if (
        //   //special case: tile can contains reference to a prev board in records!
        //   tile &&
        //   tile.loadBoard &&
        //   prevBoardsRecords.includes(tile.loadBoard)
        // ) {
        //   const el = records.find(e => e.prev === tile.loadBoard);
        //   b.tiles.splice(index, 1, {
        //     ...tile,
        //     loadBoard: el.next
        //   });
        //   try {
        //     updateBoard(b);
        //   } catch (err) {
        //     console.log(err.message);
        //   }
        // }
        if (
          //general case: tile can contains reference to the board
          tile &&
          tile.loadBoard &&
          nextBoardsRecords.includes(b.id)
        ) {
          console.log('Entro a actualizar el loadBoard');
          if (tile.loadBoard === records[records.length - 1].prev) {
            console.log('board a actualizar', b.id);
            //const el = records.find(e => e.next === b.id);
            // b.tiles.splice(index, 1, {
            //   ...tile,
            //   loadBoard: newBoard.id
            // });
            const boardToUpdate = JSON.parse(JSON.stringify(b));
            boardToUpdate.tiles.splice(index, 1, {
              ...tile,
              loadBoard: newBoard.id
            });
            try {
              console.log(boardToUpdate);
              updateBoard(boardToUpdate);
            } catch (err) {
              console.log(err.message);
            }
          }
        }
      });
    });
  }

  handleCloseDialog = () => {
    this.setState({
      copyPublicBoard: false,
      blockedPrivateBoard: false
    });
  };

  publishBoard = () => {
    const { board, updateBoard } = this.props;
    const newBoard = {
      ...board,
      isPublic: !board.isPublic
    };
    const processedBoard = this.updateIfFeaturedBoard(newBoard);
    updateBoard(processedBoard);
    this.saveApiBoardOperation(processedBoard);
  };

  handleCopyTiles = () => {
    const { intl, showNotification } = this.props;
    const copiedTiles = this.selectedTiles();
    this.setState({
      copiedTiles: copiedTiles,
      copiedTilesBoardId: this.props.board.id
    });
    showNotification(intl.formatMessage(messages.tilesCopiedSuccessfully));
    console.log(copiedTiles);
  };

  handlePasteTiles = async () => {
    const { intl, showNotification } = this.props;
    if (
      this.props.communicator.activeBoardId !== this.state.copiedTilesBoardId
    ) {
      for await (const tile of this.state.copiedTiles) {
        if (tile.loadBoard) {
          let board = this.props.boards.filter(board => {
            return board.id === tile.loadBoard;
          });
          try {
            await this.createRecursively(board[0], null, tile);
            showNotification(
              intl.formatMessage(messages.boardCopiedSuccessfully)
            );
          } catch (err) {
            console.log(err.message);
            showNotification(intl.formatMessage(messages.boardCopyError));
          }
        } else {
          const newTile = { ...tile };
          newTile['id'] = shortid.generate();
          this.handleAddTileEditorSubmit(newTile);
        }
      }
    }
  };
  async createRecursively(board, records, tile) {
    console.log(board);
    const {
      createBoard,
      addBoardCommunicator,
      upsertCommunicator,
      changeCommunicator,
      history,
      communicator,
      userData,
      updateApiObjectsNoChild,
      boards,
      intl,
      createTile
    } = this.props;

    //prevent shit
    if (!board) {
      return;
    }
    if (records) {
      //get the list of next boards in records
      let nextBoardsRecords = records.map(entry => entry.next);
      if (nextBoardsRecords.includes(board.id)) {
        console.log('HOLA ME FUI');
        return;
      }
    }

    let newBoard = {
      ...board,
      isPublic: false,
      id: shortid.generate(),
      hidden: false,
      author: '',
      email: ''
    };
    if (!newBoard.name) {
      newBoard.name = newBoard.nameKey
        ? intl.formatMessage({ id: newBoard.nameKey })
        : intl.formatMessage(messages.noTitle);
    }
    if ('name' in userData && 'email' in userData) {
      newBoard = {
        ...newBoard,
        author: userData.name,
        email: userData.email
      };
    }
    createBoard(newBoard);
    console.log(newBoard);
    console.log(tile);

    let newTile = {
      ...tile,
      loadBoard: newBoard.id,
      type: 'folder',
      linkedBoard: false,
      sound: '',
      vocalization: ''
    };

    if (!records) {
      console.log(newTile);
      // await addBoardCommunicator(newBoard.id);
      //this.updateIfFeaturedBoard(this.props.board);
      createTile(newTile, this.props.board.id);
    }

    // Loggedin user?
    if ('name' in userData && 'email' in userData) {
      this.setState({
        isSaving: true
      });
      let createCommunicator = false;
      if (communicator.email !== userData.email) {
        //need to create a new communicator
        const communicatorData = {
          ...communicator,
          author: userData.name,
          email: userData.email,
          id: shortid.generate()
        };
        upsertCommunicator(communicatorData);
        changeCommunicator(communicatorData.id);
        createCommunicator = true;
      }
      try {
        const boardId = await updateApiObjectsNoChild(
          newBoard,
          createCommunicator,
          true
        );
        newBoard = {
          ...newBoard,
          id: boardId
        };
        // if (!records) {
        //   newTile = { ...newTile, loadBoard: boardId }
        //   await this.handleApiUpdates(newTile);
        // }
      } catch (err) {
        console.log(err.message);
      }
    }
    if (!records) {
      records = [{ prev: board.id, next: newBoard.id }];
      // const translatedBoard = this.translateBoard(newBoard);
      this.setState({
        //   translatedBoard,
        isSaving: false
        //   copyPublicBoard: false,
        //   blockedPrivateBoard: false
      });
    } else {
      records.push({ prev: board.id, next: newBoard.id });
      this.updateBoardReferences(board, newBoard, records);
    }
    //

    if (board.tiles.length < 1) {
      return;
    }

    //return condition
    board.tiles.forEach(async tile => {
      if (tile.loadBoard) {
        try {
          const nextBoard = await API.getBoard(tile.loadBoard);
          this.createRecursively(nextBoard, records);
        } catch (err) {
          if (err.response.status === 404) {
            //look for this board in available boards
            const localBoard = boards.find(b => b.id === tile.loadBoard);
            if (localBoard) {
              this.createRecursively(localBoard, records);
            }
          }
        }
      }
    });
    this.setState({ isSaving: false });
  }
  selectedTiles = () => {
    return this.state.selectedTileIds
      ? this.state.selectedTileIds.map(selectedTileId => {
          const tiles = this.props.board.tiles.filter(tile => {
            return tile.id === selectedTileId;
          })[0];

          return tiles;
        })
      : [];
  };

  render() {
    const { navHistory, board, focusTile } = this.props;

    if (!this.state.translatedBoard) {
      return (
        <div className="Board__loading">
          <CircularProgress size={60} thickness={5} color="inherit" />
        </div>
      );
    }

    const disableBackButton = navHistory.length === 1;
    const editingTiles = this.state.tileEditorOpen
      ? this.state.selectedTileIds.map(selectedTileId => {
          const tiles = board.tiles.filter(tile => {
            return tile.id === selectedTileId;
          })[0];

          return tiles;
        })
      : [];

    return (
      <Fragment>
        <Board
          board={this.state.translatedBoard}
          intl={this.props.intl}
          scannerSettings={this.props.scannerSettings}
          deactivateScanner={this.props.deactivateScanner}
          disableBackButton={disableBackButton}
          userData={this.props.userData}
          isLocked={this.state.isLocked}
          isSaving={this.state.isSaving}
          isSelecting={this.state.isSelecting}
          isSelectAll={this.state.isSelectAll}
          isFixedBoard={this.state.isFixedBoard}
          isRootBoardTourEnabled={this.props.isRootBoardTourEnabled}
          isUnlockedTourEnabled={this.props.isUnlockedTourEnabled}
          //updateBoard={this.handleUpdateBoard}
          onAddClick={this.handleAddClick}
          onDeleteClick={this.handleDeleteClick}
          onEditClick={this.handleEditClick}
          onSelectAllToggle={this.handleSelectAllToggle}
          onFocusTile={focusTile}
          onLockClick={this.handleLockClick}
          onLockNotify={this.handleLockNotify}
          onScannerActive={this.handleScannerStrategyNotification}
          onRequestPreviousBoard={this.onRequestPreviousBoard.bind(this)}
          onRequestToRootBoard={this.props.toRootBoard}
          onSelectClick={this.handleSelectClick}
          onTileClick={this.handleTileClick}
          onBoardTypeChange={this.handleBoardTypeChange}
          editBoardTitle={this.handleEditBoardTitle}
          selectedTileIds={this.state.selectedTileIds}
          displaySettings={this.props.displaySettings}
          navigationSettings={this.props.navigationSettings}
          navHistory={this.props.navHistory}
          publishBoard={this.publishBoard}
          showNotification={this.props.showNotification}
          emptyVoiceAlert={this.props.emptyVoiceAlert}
          offlineVoiceAlert={this.props.offlineVoiceAlert}
          onAddRemoveColumn={this.handleAddRemoveColumn}
          onAddRemoveRow={this.handleAddRemoveRow}
          onTileDrop={this.handleTileDrop}
          onLayoutChange={this.handleLayoutChange}
          disableTour={this.props.disableTour}
          onCopyTiles={this.handleCopyTiles}
          onPasteTiles={this.handlePasteTiles}
        />
        <Dialog
          open={!!this.state.copyPublicBoard}
          TransitionComponent={Transition}
          keepMounted
          onClose={this.handleCloseDialog}
          aria-labelledby="dialog-copy-title"
          aria-describedby="dialog-copy-desc"
        >
          <DialogTitle id="dialog-copy-board-title">
            {this.props.intl.formatMessage(messages.copyPublicBoardTitle)}
          </DialogTitle>
          <DialogContent>
            <DialogContentText id="dialog-copy-board-desc">
              {this.props.intl.formatMessage(messages.copyPublicBoardDesc)}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={this.handleCloseDialog} color="primary">
              {this.props.intl.formatMessage(messages.boardCopyCancel)}
            </Button>
            <Button
              onClick={this.handleCopyRemoteBoard}
              color="primary"
              variant="contained"
            >
              {this.props.intl.formatMessage(messages.boardCopyAccept)}
            </Button>
          </DialogActions>
        </Dialog>
        <Dialog
          open={this.state.blockedPrivateBoard}
          TransitionComponent={Transition}
          keepMounted
          onClose={this.handleCloseDialog}
          aria-labelledby="dialog-blocked-title"
          aria-describedby="dialog-blocked-desc"
        >
          <DialogTitle id="dialog-blocked-board-title">
            {this.props.intl.formatMessage(messages.blockedPrivateBoardTitle)}
          </DialogTitle>
          <DialogContent>
            <DialogContentText id="dialog-blocked-board-desc">
              {this.props.intl.formatMessage(messages.blockedPrivateBoardDesc)}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={this.handleCloseDialog}
              color="primary"
              variant="contained"
            >
              {this.props.intl.formatMessage(messages.boardCopyAccept)}
            </Button>
          </DialogActions>
        </Dialog>

        <TileEditor
          editingTiles={editingTiles}
          open={this.state.tileEditorOpen}
          onClose={this.handleTileEditorCancel}
          onEditSubmit={this.handleEditTileEditorSubmit}
          onAddSubmit={this.handleAddTileEditorSubmit}
          boards={this.props.boards}
          userData={this.props.userData}
        />
      </Fragment>
    );
  }
}

const mapStateToProps = ({
  board,
  communicator,
  speech,
  scanner,
  app: { displaySettings, navigationSettings, userData, isConnected, liveHelp },
  language: { lang }
}) => {
  const activeCommunicatorId = communicator.activeCommunicatorId;
  const currentCommunicator = communicator.communicators.find(
    communicator => communicator.id === activeCommunicatorId
  );
  const activeBoardId = board.activeBoardId;
  const currentVoice = speech.voices.find(
    v => v.voiceURI === speech.options.voiceURI
  );
  const emptyVoiceAlert =
    speech.voices.length > 0 && speech.options.voiceURI !== EMPTY_VOICES
      ? false
      : true;
  const offlineVoiceAlert =
    !isConnected &&
    speech.voices.length &&
    currentVoice &&
    currentVoice.voiceSource === 'cloud';
  return {
    communicator: currentCommunicator,
    board: board.boards.find(board => board.id === activeBoardId),
    boards: board.boards,
    output: board.output,
    scannerSettings: scanner,
    navHistory: board.navHistory,
    displaySettings,
    navigationSettings,
    userData,
    emptyVoiceAlert,
    lang,
    offlineVoiceAlert,
    isRootBoardTourEnabled: liveHelp.isRootBoardTourEnabled,
    isUnlockedTourEnabled: liveHelp.isUnlockedTourEnabled
  };
};

const mapDispatchToProps = {
  addBoards,
  changeBoard,
  replaceBoard,
  previousBoard,
  toRootBoard,
  historyRemoveBoard,
  createBoard,
  updateBoard,
  switchBoard,
  createTile,
  deleteTiles,
  editTiles,
  focusTile,
  clickSymbol,
  changeOutput,
  speak,
  cancelSpeech,
  showNotification,
  hideNotification,
  deactivateScanner,
  upsertCommunicator,
  changeCommunicator,
  addBoardCommunicator,
  updateApiObjects,
  updateApiObjectsNoChild,
  getApiObjects,
  downloadImages,
  disableTour
};

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(injectIntl(BoardContainer));
