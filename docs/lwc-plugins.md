Plugins
Plugins allow you to extend the library's functionality and render custom elements, such as new series, drawing tools, indicators, and watermarks.

You can create plugins of the following types:

Custom series — define new types of series.
Primitives — define custom visualizations, drawing tools, and chart annotations that can be attached to an existing series (series primitives) or chart pane (pane primitives).
Tips
Use the create-lwc-plugin npm package to quickly scaffold a project for your custom plugin.
Explore the Plugin Examples Demo page that hosts interactive examples of heatmaps, alerts, watermarks, and tooltips implemented with plugins. You can find the code of these examples in the plugin-examples folder in the Lightweight Charts™ repository.
Custom series
Custom series allow you to define new types of series with custom data structures and rendering logic. For implementation details, refer to the Custom Series Types article.

Use the addCustomSeries method to add a custom series to the chart. Then, you can manage it through the same API available for built-in series. For example, call the setData method to populate the series with data.

javascript
class MyCustomSeries {
    /* Class implementing the ICustomSeriesPaneView interface */
}

// Create an instantiated custom series
const customSeriesInstance = new MyCustomSeries();

const chart = createChart(document.getElementById('container'));
const myCustomSeries = chart.addCustomSeries(customSeriesInstance, {
    // Options for MyCustomSeries
    customOption: 10,
});

const data = [
    { time: 1642425322, value: 123, customValue: 456 },
    /* ... more data */
];

myCustomSeries.setData(data);

Primitives
Primitives allow you to define custom visualizations, drawing tools, and chart annotations. You can render them at different levels in the visual stack to create complex, layered compositions.

Series primitives
Series primitives are attached to a specific series and can render on the main pane, price and time scales. For implementation details, refer to the Series Primitives article.

Use the attachPrimitive method to add a primitive to the chart and attach it to the series.

javascript
class MyCustomPrimitive {
    /* Class implementing the ISeriesPrimitive interface */
}

// Create an instantiated series primitive
const myCustomPrimitive = new MyCustomPrimitive();

const chart = createChart(document.getElementById('container'));
const lineSeries = chart.addSeries(LineSeries);

const data = [
    { time: 1642425322, value: 123 },
    /* ... more data */
];

// Attach the primitive to the series
lineSeries.attachPrimitive(myCustomPrimitive);

Pane primitives
Pane primitives are attached to a chart pane rather than a specific series. You can use them to create chart-wide annotations and features like watermarks. For implementation details, refer to the Pane Primitives article.

caution
Note that pane primitives cannot render on the price or time scale.

Use the attachPrimitive method to add a primitive to the chart and attach it to the pane.

class MyCustomPanePrimitive {
    /* Class implementing the IPanePrimitive interface */
}

// Create an instantiated pane primitive
const myCustomPanePrimitive = new MyCustomPanePrimitive();

const chart = createChart(document.getElementById('container'));
// Get the main pane
const mainPane = chart.panes()[0];

// Attach the primitive to the pane
mainPane.attachPrimitive(myCustomPanePrimitive);

Series Primitives
Primitives are extensions to the series which can define views and renderers to draw on the chart using CanvasRenderingContext2D.

Primitives are defined by implementing the ISeriesPrimitive interface. The interface defines the basic functionality and structure required for creating custom primitives.

Views
The primary purpose of a series primitive is to provide one, or more, views to the library which contain the state and logic required to draw on the chart panes.

There are two types of views which are supported within ISeriesPrimitive which are:

IPrimitivePaneView
ISeriesPrimitiveAxisView
The library will evoke the following getter functions (if defined) to get references to the primitive's defined views for the corresponding section of the chart:

paneViews
priceAxisPaneViews
timeAxisPaneViews
priceAxisViews
timeAxisViews
The first three views allow drawing on the corresponding panes (main chart pane, price scale pane, and horizontal time scale pane) using the CanvasRenderingContext2D and should implement the ISeriesPrimitivePaneView interface.

The views returned by the priceAxisViews and timeAxisViews getter methods should implement the ISeriesPrimitiveAxisView interface and are used to define labels to be drawn on the corresponding scales.

Below is a visual example showing the various sections of the chart where a Primitive can draw.


IPrimitivePaneView
The IPrimitivePaneView interface can be used to define a view which provides a renderer (implementing the IPrimitivePaneRenderer interface) for drawing on the corresponding area of the chart using the CanvasRenderingContext2D API. The view can define a zOrder to control where in the visual stack the drawing will occur (See PrimitivePaneViewZOrder for more information).

Renderers should provide a draw method which will be given a CanvasRenderingTarget2D target on which it can draw. Additionally, a renderer can optionally provide a drawBackground method for drawing beneath other elements on the same zOrder.

tip
CanvasRenderingTarget2D is explained in more detail on the Canvas Rendering Target page.

Interactive Demo of zOrder layers
Below is an interactive demo chart illustrating where each zOrder is drawn relative to the existing chart elements such as the grid, series, and crosshair.


ISeriesPrimitiveAxisView
The ISeriesPrimitiveAxisView interface can be used to define a label on the price or time axis.

This interface provides several methods to define the appearance and position of the label, such as the coordinate method, which should return the desired coordinate for the label on the axis. It also defines optional methods to set the fixed coordinate, text, text color, background color, and visibility of the label.

Please see the ISeriesPrimitiveAxisView interface for more details.

Lifecycle Methods
Your primitive can use the attached and detached lifecycle methods to manage the lifecycle of the primitive, such as creating or removing external objects and event handlers.

attached
This method is called when the primitive is attached to a chart. The attached method is evoked with a single argument containing properties for the chart, series, and a callback to request an update. The chart and series properties are references to the chart API and the series API instances for convenience purposes so that they don't need to be manually provided within the primitive's constructor (if needed by the primitive).

The requestUpdate callback allows the primitive to notify the chart that it should be updated and redrawn.

detached
This method is called when the primitive is detached from a chart. This can be used to remove any external objects or event handlers that were created during the attached lifecycle method.

Updating Views
Your primitive should update the views in the updateAllViews() method such that when the renderers are evoked, they can draw with the latest information. The library invokes this method when it wants to update and redraw the chart. If you would like to notify the library that it should trigger an update then you can use the requestUpdate callback provided by the attached lifecycle method.

Extending the Autoscale Info
The autoscaleInfo() method can be provided to extend the base autoScale information of the series. This can be used to ensure that the chart is automatically scaled correctly to include all the graphics drawn by the primitive.

Whenever the chart needs to calculate the vertical visible range of the series within the current time range then it will evoke this method. This method can be omitted and the library will use the normal autoscale information for the series. If the method is implemented then the returned values will be merged with the base autoscale information to define the vertical visible range.

warning
Please note that this method will be evoked very often during scrolling and zooming of the chart, thus it is recommended that this method is either simple to execute, or makes use of optimisations such as caching to ensure that the chart remains responsive.

Pane Primitives
In addition to Series Primitives, the library now supports Pane Primitives. These are essentially the same as Series Primitives but are designed to draw on the pane of a chart rather than being associated with a specific series. Pane Primitives can be used for features like watermarks or other chart-wide annotations.

Key Differences from Series Primitives
Pane Primitives are attached to the chart pane rather than a specific series.
They cannot draw on the price and time scales.
They are ideal for chart-wide features that are not tied to a particular series.
Adding a Pane Primitive
Pane Primitives can be added to a chart using the attachPrimitive method on the IPaneApi interface. Here's an example:

const chart = createChart(document.getElementById('container'));
const pane = chart.panes()[0]; // Get the first (main) pane

const myPanePrimitive = new MyCustomPanePrimitive();
pane.attachPrimitive(myPanePrimitive);

Implementing a Pane Primitive
To create a Pane Primitive, you should implement the IPanePrimitive interface. This interface is similar to ISeriesPrimitive, but with some key differences:

It doesn't include methods for drawing on price and time scales.
The paneViews method is used to define what will be drawn on the chart pane.
Here's a basic example of a Pane Primitive implementation:

class MyCustomPanePrimitive {
    paneViews() {
        return [
            {
                renderer: {
                    draw: target => {
                        // Custom drawing logic here
                    },
                },
            },
        ];
    }

    // Other methods as needed...
}

For more details on implementing Pane Primitives, refer to the IPanePrimitive interface documentation.

Custom Series Types
Custom series allow developers to create new types of series with their own data structures, and rendering logic (implemented using CanvasRenderingContext2D methods). These custom series extend the current capabilities of our built-in series, providing a consistent API which mirrors the built-in chart types.

note
These series are expected to have a uniform width for each data point, which ensures that the chart maintains a consistent look and feel across all series types. The only restriction on the data structure is that it should extend the CustomData interface (have a valid time property for each data point).

Defining a Custom Series
A custom series should implement the ICustomSeriesPaneView interface. The interface defines the basic functionality and structure required for creating a custom series view.

It includes the following methods and properties:

Renderer
ICustomSeriesPaneView property: renderer
This method should return a renderer which implements the ICustomSeriesPaneRenderer interface and is used to draw the series data on the main chart pane.

The draw method of the renderer is evoked whenever the chart needs to draw the series.

The PriceToCoordinateConverter provided as the 2nd argument to the draw method is a convenience function for changing prices into vertical coordinate values. It is provided since the series' original data will most likely be defined in price values, and the renderer needs to draw with coordinates. The values returned by the converter will be defined in mediaSize (unscaled by devicePixelRatio).

tip
CanvasRenderingTarget2D provided within the draw function is explained in more detail on the Canvas Rendering Target page.

Update
ICustomSeriesPaneView property: update
This method will be called with the latest data for the renderer to use during the next paint.

The update method is evoked with two parameters: data (discussed below), and seriesOptions. seriesOptions is a reference to the currently applied options for the series

The PaneRendererCustomData interface provides the data that can be used within the renderer for drawing the series data. It includes the following properties:

bars: List of all the series' items and their x coordinates. See CustomBarItemData for more details
barSpacing: Spacing between consecutive bars.
visibleRange: The current visible range of items on the chart.
Hit Testing
ICustomSeriesPaneRenderer property: hitTest
This optional method allows a custom series to participate directly in hover and click resolution.

Return null when the cursor misses the custom geometry. Return a CustomSeriesHitTestResult when the cursor hits a custom object. The result can provide:

distance: geometric distance from the cursor to the hit
type: optional geometric classification such as point, line, range, or custom
objectId: optional object identifier that becomes hoveredObjectId
cursorStyle: optional cursor override
hitTestData: optional renderer-defined hover data passed back into draw
This hook lets the custom series participate in the same geometry-first arbitration model as built-in series.

The type field is used for hover arbitration only. Public mouse events still report hoveredInfo.type as custom for custom-series hits. Use objectId and hoveredInfo.objectKind to distinguish custom sub-objects.

Price Value Builder
ICustomSeriesPaneView property: priceValueBuilder
A function for interpreting the custom series data and returning an array of numbers representing the prices values for the item, specifically the equivalent highest, lowest, and current price values for the data item.

These price values are used by the chart to determine the auto-scaling (to ensure the items are in view) and the crosshair and price line positions. The largest and smallest values in the array will be used to specify the visible range of the painted item, and the last value will be used for the crosshair and price line position.

Whitespace
ICustomSeriesPaneView property: isWhitespace
A function used by the library to determine which data points provided by the user should be considered Whitespace. The method should return true when the data point is Whitespace. Data points which are whitespace data won't be provided to the renderer, or the priceValueBuilder.

Default Options
ICustomSeriesPaneView property: defaultOptions
The default options to be used for the series. The user can override these values using the options argument in addCustomSeries, or via the applyOptions method on the ISeriesAPI.

Destroy
ICustomSeriesPaneView property: destroy
This method will be evoked when the series has been removed from the chart. This method should be used to clean up any objects, references, and other items that could potentially cause memory leaks.

This method should contain all the necessary code to clean up the object before it is removed from memory. This includes removing any event listeners or timers that are attached to the object, removing any references to other objects, and resetting any values or properties that were modified during the lifetime of the object.

Canvas Rendering Target
The renderer functions used within the plugins (both Custom Series, and Drawing Primitives) are provided with a CanvasRenderingTarget2D interface on which the drawing logic (using the Browser's 2D Canvas API) should be executed. CanvasRenderingTarget2D is provided by the Fancy Canvas library.

info
The typescript definitions can be viewed here:

fancy-canvas on npmjs.com
and specifically the definition for CanvasRenderingTarget2D can be viewed here:

canvas-rendering-target.d.ts
Using CanvasRenderingTarget2D
CanvasRenderingTarget2D provides two rendering scope which you can use:

useMediaCoordinateSpace
useBitmapCoordinateSpace
Difference between Bitmap and Media
Bitmap sizing represents the actual physical pixels on the device's screen, while the media size represents the size of a pixel according to the operating system (and browser) which is generally an integer representing the ratio of actual physical pixels are used to render a media pixel. This integer ratio is referred to as the device pixel ratio.

Using the bitmap sizing allows for more control over the drawn image to ensure that the graphics are crisp and pixel perfect, however this generally means that the code will contain a lot multiplication of coordinates by the pixel ratio. In cases where you don't need to draw using the bitmap sizing then it is easier to use media sizing as you don't need to worry about the devices pixel ratio.

Bitmap Coordinate Space
useBitmapCoordinateSpace can be used to if you would like draw using the actual devices pixels as the coordinate sizing. The provided scope (of type BitmapCoordinatesRenderingScope) contains readonly values for the following:

context (CanvasRenderingContext2D). Context which can be used for rendering.
horizontalPixelRatio (number)
verticalPixelRatio (number)
bitmapSize (Size). Height and width of the canvas in bitmap dimensions.
mediaSize (Size). Height and width of the canvas in media dimensions.
Bitmap Coordinate Space Usage
javascript
// target is an instance of CanvasRenderingTarget2D
target.useBitmapCoordinateSpace(scope => {
    // scope is an instance of BitmapCoordinatesRenderingScope

    // example of drawing a filled rectangle which fills the canvas
    scope.context.beginPath();
    scope.context.rect(0, 0, scope.bitmapSize.width, scope.bitmapSize.height);
    scope.context.fillStyle = 'rgba(100, 200, 50, 0.5)';
    scope.context.fill();
});

Media Coordinate Space
useMediaCoordinateSpace can be used to if you would like draw using the media dimensions as the coordinate sizing. The provided scope (of type MediaCoordinatesRenderingScope) contains readonly values for the following:

context (CanvasRenderingContext2D). Context which can be used for rendering.
mediaSize (Size). Height and width of the canvas in media dimensions.
Media Coordinate Space Usage
javascript
// target is an instance of CanvasRenderingTarget2D
target.useMediaCoordinateSpace(scope => {
    // scope is an instance of BitmapCoordinatesRenderingScope

    // example of drawing a filled rectangle which fills the canvas
    scope.context.beginPath();
    scope.context.rect(0, 0, scope.mediaSize.width, scope.mediaSize.height);
    scope.context.fillStyle = 'rgba(100, 200, 50, 0.5)';
    scope.context.fill();
});

General Tips
It is recommended that rendering functions should save and restore the canvas context before and after all the rendering logic to ensure that the canvas state is the same as when the renderer function was evoked. To handle the case when an error in the code might prevent the restore function from being evoked, you should use the try - finally code block to ensure that the context is correctly restored in all cases.

Note that useBitmapCoordinateSpace and useMediaCoordinateSpace will automatically save and restore the canvas context for the logic defined within them. This tip for your additional rendering functions within the use*CoordinateSpace.

javascript
function myRenderingFunction(scope) {
    const ctx = scope.context;

    // save the current state of the context to the stack
    ctx.save();

    try {
        // example code
        scope.context.beginPath();
        scope.context.rect(0, 0, scope.mediaSize.width, scope.mediaSize.height);
        scope.context.fillStyle = 'rgba(100, 200, 50, 0.5)';
        scope.context.fill();
    } finally {
        // restore the saved context from the stack
        ctx.restore();
    }
}

target.useMediaCoordinateSpace(scope => {
    myRenderingFunction(scope);
    myOtherRenderingFunction(scope);
    /* ... */
});

Best Practices for Pixel Perfect Rendering in Canvas Drawings
To achieve crisp pixel perfect rendering for your plugins, it is recommended that the canvas drawings are created using bitmap coordinates. The difference between media and bitmap coordinate spaces is discussed on the Canvas Rendering Target page. Essentially, all drawing actions should use integer positions and dimensions when on the bitmap coordinate space.

To ensure consistency between your plugins and the library's built-in logic for rendering points on the chart, use of the following calculation functions.

info
Variable names containing media refer to positions / dimensions specified using the media coordinate space (such as the x and y coordinates provided by the library to the renderers), and names containing bitmap refer to positions / dimensions on the bitmap coordinate space (actual device screen pixels).

Centered Shapes
If you need to draw a shape which is centred on a position (for example a price or x coordinate) and has a desired width then you could use the positionsLine function presented below. This can be used for drawing a horizontal line at a specific price, or a vertical line aligned with the centre of series point.

interface BitmapPositionLength {
    /** coordinate for use with a bitmap rendering scope */
    position: number;
    /** length for use with a bitmap rendering scope */
    length: number;
}

function centreOffset(lineBitmapWidth: number): number {
    return Math.floor(lineBitmapWidth * 0.5);
}

/**
 * Calculates the bitmap position for an item with a desired length (height or width), and centred according to
 * a position coordinate defined in media sizing.
 * @param positionMedia - position coordinate for the bar (in media coordinates)
 * @param pixelRatio - pixel ratio. Either horizontal for x positions, or vertical for y positions
 * @param desiredWidthMedia - desired width (in media coordinates)
 * @returns Position of the start point and length dimension.
 */
export function positionsLine(
    positionMedia: number,
    pixelRatio: number,
    desiredWidthMedia: number = 1,
    widthIsBitmap?: boolean
): BitmapPositionLength {
    const scaledPosition = Math.round(pixelRatio * positionMedia);
    const lineBitmapWidth = widthIsBitmap
        ? desiredWidthMedia
        : Math.round(desiredWidthMedia * pixelRatio);
    const offset = centreOffset(lineBitmapWidth);
    const position = scaledPosition - offset;
    return { position, length: lineBitmapWidth };
}


Dual Point Shapes
If you need to draw a shape between two coordinates (for example, y coordinates for a high and low price) then you can use the positionsBox function as presented below.

/**
 * Determines the bitmap position and length for a dimension of a shape to be drawn.
 * @param position1Media - media coordinate for the first point
 * @param position2Media - media coordinate for the second point
 * @param pixelRatio - pixel ratio for the corresponding axis (vertical or horizontal)
 * @returns Position of the start point and length dimension.
 */
export function positionsBox(
    position1Media: number,
    position2Media: number,
    pixelRatio: number
): BitmapPositionLength {
    const scaledPosition1 = Math.round(pixelRatio * position1Media);
    const scaledPosition2 = Math.round(pixelRatio * position2Media);
    return {
        position: Math.min(scaledPosition1, scaledPosition2),
        length: Math.abs(scaledPosition2 - scaledPosition1) + 1,
    };
}

Default Widths
Please refer to the following pages for functions defining the default widths of shapes drawn by the library:

Crosshair and Grid Lines
Candlesticks
Columns (Histogram)
Full Bar Width

Candlestick Width Calculations
tip
It is recommend that you first read the Pixel Perfect Rendering page.

The following functions can be used to get the calculated width that the library would use for a candlestick at a specific bar spacing and device pixel ratio.

Below a bar spacing of 4, the library will attempt to use as large a width as possible without the possibility of overlapping, whilst above 4 then the width will start to trend towards an 80% width of the available space.

warning
It is expected that candles can overlap slightly at smaller bar spacings (more pronounced on lower resolution devices). This produces a more readable chart. If you need to ensure that bars can never overlap then rather use the widths for Columns or the full bar width calculation.

function optimalCandlestickWidth(
    barSpacing: number,
    pixelRatio: number
): number {
    const barSpacingSpecialCaseFrom = 2.5;
    const barSpacingSpecialCaseTo = 4;
    const barSpacingSpecialCaseCoeff = 3;
    if (barSpacing >= barSpacingSpecialCaseFrom && barSpacing <= barSpacingSpecialCaseTo) {
        return Math.floor(barSpacingSpecialCaseCoeff * pixelRatio);
    }
    // coeff should be 1 on small barspacing and go to 0.8 while bar spacing grows
    const barSpacingReducingCoeff = 0.2;
    const coeff =
        1 -
        (barSpacingReducingCoeff *
            Math.atan(
                Math.max(barSpacingSpecialCaseTo, barSpacing) - barSpacingSpecialCaseTo
            )) /
            (Math.PI * 0.5);
    const res = Math.floor(barSpacing * coeff * pixelRatio);
    const scaledBarSpacing = Math.floor(barSpacing * pixelRatio);
    const optimal = Math.min(res, scaledBarSpacing);
    return Math.max(Math.floor(pixelRatio), optimal);
}

/**
 * Calculates the candlestick width that the library would use for the current
 * bar spacing.
 * @param barSpacing - bar spacing in media coordinates
 * @param horizontalPixelRatio - horizontal pixel ratio
 * @returns The width (in bitmap coordinates) that the chart would use to draw a candle body
 */
export function candlestickWidth(
    barSpacing: number,
    horizontalPixelRatio: number
): number {
    let width = optimalCandlestickWidth(barSpacing, horizontalPixelRatio);
    if (width >= 2) {
        const wickWidth = Math.floor(horizontalPixelRatio);
        if (wickWidth % 2 !== width % 2) {
            width--;
        }
    }
    return width;
}

Histogram Column Width Calculations
tip
It is recommend that you first read the Pixel Perfect Rendering page.

The following functions can be used to get the calculated width that the library would use for a histogram column at a specific bar spacing and device pixel ratio.

You can use the calculateColumnPositionsInPlace function instead of the calculateColumnPositions function to perform the calculation on an existing array of items without needing to create additional arrays (which is more efficient). It is recommended that you memoize the majority of the calculations below to improve the rendering performance.

const alignToMinimalWidthLimit = 4;
const showSpacingMinimalBarWidth = 1;

/**
 * Spacing gap between columns.
 * @param barSpacingMedia - spacing between bars (media coordinate)
 * @param horizontalPixelRatio - horizontal pixel ratio
 * @returns Spacing gap between columns (in Bitmap coordinates)
 */
function columnSpacing(barSpacingMedia: number, horizontalPixelRatio: number) {
    return Math.ceil(barSpacingMedia * horizontalPixelRatio) <=
        showSpacingMinimalBarWidth
        ? 0
        : Math.max(1, Math.floor(horizontalPixelRatio));
}

/**
 * Desired width for columns. This may not be the final width because
 * it may be adjusted later to ensure all columns on screen have a
 * consistent width and gap.
 * @param barSpacingMedia - spacing between bars (media coordinate)
 * @param horizontalPixelRatio - horizontal pixel ratio
 * @param spacing - Spacing gap between columns (in Bitmap coordinates). (optional, provide if you have already calculated it)
 * @returns Desired width for column bars (in Bitmap coordinates)
 */
function desiredColumnWidth(
    barSpacingMedia: number,
    horizontalPixelRatio: number,
    spacing?: number
) {
    return (
        Math.round(barSpacingMedia * horizontalPixelRatio) -
        (spacing ?? columnSpacing(barSpacingMedia, horizontalPixelRatio))
    );
}

interface ColumnCommon {
    /** Spacing gap between columns */
    spacing: number;
    /** Shift columns left by one pixel */
    shiftLeft: boolean;
    /** Half width of a column */
    columnHalfWidthBitmap: number;
    /** horizontal pixel ratio */
    horizontalPixelRatio: number;
}

/**
 * Calculated values which are common to all the columns on the screen, and
 * are required to calculate the individual positions.
 * @param barSpacingMedia - spacing between bars (media coordinate)
 * @param horizontalPixelRatio - horizontal pixel ratio
 * @returns calculated values for subsequent column calculations
 */
function columnCommon(
    barSpacingMedia: number,
    horizontalPixelRatio: number
): ColumnCommon {
    const spacing = columnSpacing(barSpacingMedia, horizontalPixelRatio);
    const columnWidthBitmap = desiredColumnWidth(
        barSpacingMedia,
        horizontalPixelRatio,
        spacing
    );
    const shiftLeft = columnWidthBitmap % 2 === 0;
    const columnHalfWidthBitmap = (columnWidthBitmap - (shiftLeft ? 0 : 1)) / 2;
    return {
        spacing,
        shiftLeft,
        columnHalfWidthBitmap,
        horizontalPixelRatio,
    };
}

interface ColumnPosition {
    left: number;
    right: number;
    shiftLeft: boolean;
}

/**
 * Calculate the position for a column. These values can be later adjusted
 * by a second pass which corrects widths, and shifts columns.
 * @param xMedia - column x position (center) in media coordinates
 * @param columnData - precalculated common values (returned by `columnCommon`)
 * @param previousPosition - result from this function for the previous bar.
 * @returns initial column position
 */
function calculateColumnPosition(
    xMedia: number,
    columnData: ColumnCommon,
    previousPosition: ColumnPosition | undefined
): ColumnPosition {
    const xBitmapUnRounded = xMedia * columnData.horizontalPixelRatio;
    const xBitmap = Math.round(xBitmapUnRounded);
    const xPositions: ColumnPosition = {
        left: xBitmap - columnData.columnHalfWidthBitmap,
        right:
            xBitmap +
            columnData.columnHalfWidthBitmap -
            (columnData.shiftLeft ? 1 : 0),
        shiftLeft: xBitmap > xBitmapUnRounded,
    };
    const expectedAlignmentShift = columnData.spacing + 1;
    if (previousPosition) {
        if (xPositions.left - previousPosition.right !== expectedAlignmentShift) {
            // need to adjust alignment
            if (previousPosition.shiftLeft) {
                previousPosition.right = xPositions.left - expectedAlignmentShift;
            } else {
                xPositions.left = previousPosition.right + expectedAlignmentShift;
            }
        }
    }
    return xPositions;
}

function fixPositionsAndReturnSmallestWidth(
    positions: ColumnPosition[],
    initialMinWidth: number
): number {
    return positions.reduce((smallest: number, position: ColumnPosition) => {
        if (position.right < position.left) {
            position.right = position.left;
        }
        const width = position.right - position.left + 1;
        return Math.min(smallest, width);
    }, initialMinWidth);
}

function fixAlignmentForNarrowColumns(
    positions: ColumnPosition[],
    minColumnWidth: number
) {
    return positions.map((position: ColumnPosition) => {
        const width = position.right - position.left + 1;
        if (width <= minColumnWidth) return position;
        if (position.shiftLeft) {
            position.right -= 1;
        } else {
            position.left += 1;
        }
        return position;
    });
}

/**
 * Calculates the column positions and widths for the x positions.
 * This function creates a new array. You may get faster performance using the
 * `calculateColumnPositionsInPlace` function instead
 * @param xMediaPositions - x positions for the bars in media coordinates
 * @param barSpacingMedia - spacing between bars in media coordinates
 * @param horizontalPixelRatio - horizontal pixel ratio
 * @returns Positions for the columns
 */
export function calculateColumnPositions(
    xMediaPositions: number[],
    barSpacingMedia: number,
    horizontalPixelRatio: number
): ColumnPosition[] {
    const common = columnCommon(barSpacingMedia, horizontalPixelRatio);
    const positions = new Array<ColumnPosition>(xMediaPositions.length);
    let previous: ColumnPosition | undefined = undefined;
    for (let i = 0; i < xMediaPositions.length; i++) {
        positions[i] = calculateColumnPosition(
            xMediaPositions[i],
            common,
            previous
        );
        previous = positions[i];
    }
    const initialMinWidth = Math.ceil(barSpacingMedia * horizontalPixelRatio);
    const minColumnWidth = fixPositionsAndReturnSmallestWidth(
        positions,
        initialMinWidth
    );
    if (common.spacing > 0 && minColumnWidth < alignToMinimalWidthLimit) {
        return fixAlignmentForNarrowColumns(positions, minColumnWidth);
    }
    return positions;
}

export interface ColumnPositionItem {
    x: number;
    column?: ColumnPosition;
}

/**
 * Calculates the column positions and widths for bars using the existing
 * array of items.
 * @param items - bar items which include an `x` property, and will be mutated to contain a column property
 * @param barSpacingMedia - bar spacing in media coordinates
 * @param horizontalPixelRatio - horizontal pixel ratio
 * @param startIndex - start index for visible bars within the items array
 * @param endIndex - end index for visible bars within the items array
 */
export function calculateColumnPositionsInPlace(
    items: ColumnPositionItem[],
    barSpacingMedia: number,
    horizontalPixelRatio: number,
    startIndex: number,
    endIndex: number
): void {
    const common = columnCommon(barSpacingMedia, horizontalPixelRatio);
    let previous: ColumnPosition | undefined = undefined;
    for (let i = startIndex; i < Math.min(endIndex, items.length); i++) {
        items[i].column = calculateColumnPosition(items[i].x, common, previous);
        previous = items[i].column;
    }
    const minColumnWidth = (items as ColumnPositionItem[]).reduce(
        (smallest: number, item: ColumnPositionItem, index: number) => {
            if (!item.column || index < startIndex || index > endIndex)
                return smallest;
            if (item.column.right < item.column.left) {
                item.column.right = item.column.left;
            }
            const width = item.column.right - item.column.left + 1;
            return Math.min(smallest, width);
        },
        Math.ceil(barSpacingMedia * horizontalPixelRatio)
    );
    if (common.spacing > 0 && minColumnWidth < alignToMinimalWidthLimit) {
        (items as ColumnPositionItem[]).forEach(
            (item: ColumnPositionItem, index: number) => {
                if (!item.column || index < startIndex || index > endIndex) return;
                const width = item.column.right - item.column.left + 1;
                if (width <= minColumnWidth) return item;
                if (item.column.shiftLeft) {
                    item.column.right -= 1;
                } else {
                    item.column.left += 1;
                }
                return item.column;
            }
        );
    }
}

Crosshair and Grid Line Width Calculations
tip
It is recommend that you first read the Pixel Perfect Rendering page.

The following functions can be used to get the calculated width that the library would use for a crosshair or grid line at a specific device pixel ratio.

/**
 * Default grid / crosshair line width in Bitmap sizing
 * @param horizontalPixelRatio - horizontal pixel ratio
 * @returns default grid / crosshair line width in Bitmap sizing
 */
export function gridAndCrosshairBitmapWidth(
    horizontalPixelRatio: number
): number {
    return Math.max(1, Math.floor(horizontalPixelRatio));
}

/**
 * Default grid / crosshair line width in Media sizing
 * @param horizontalPixelRatio - horizontal pixel ratio
 * @returns default grid / crosshair line width in Media sizing
 */
export function gridAndCrosshairMediaWidth(
    horizontalPixelRatio: number
): number {
    return (
        gridAndCrosshairBitmapWidth(horizontalPixelRatio) / horizontalPixelRatio
    );
}


Full Bar Width Calculations
tip
It is recommend that you first read the Pixel Perfect Rendering page.

The following functions can be used to get the calculated width that the library would use for the full width of a bar (data point) at a specific bar spacing and device pixel ratio. This can be used when you would like to use the full width available for each data point on the x axis, and don't want any gaps to be visible.

interface BitmapPositionLength {
    /** coordinate for use with a bitmap rendering scope */
    position: number;
    /** length for use with a bitmap rendering scope */
    length: number;
}

/**
 * Calculates the position and width which will completely full the space for the bar.
 * Useful if you want to draw something that will not have any gaps between surrounding bars.
 * @param xMedia - x coordinate of the bar defined in media sizing
 * @param halfBarSpacingMedia - half the width of the current barSpacing (un-rounded)
 * @param horizontalPixelRatio - horizontal pixel ratio
 * @returns position and width which will completely full the space for the bar
 */
export function fullBarWidth(
    xMedia: number,
    halfBarSpacingMedia: number,
    horizontalPixelRatio: number
): BitmapPositionLength {
    const fullWidthLeftMedia = xMedia - halfBarSpacingMedia;
    const fullWidthRightMedia = xMedia + halfBarSpacingMedia;
    const fullWidthLeftBitmap = Math.round(
        fullWidthLeftMedia * horizontalPixelRatio
    );
    const fullWidthRightBitmap = Math.round(
        fullWidthRightMedia * horizontalPixelRatio
    );
    const fullWidthBitmap = fullWidthRightBitmap - fullWidthLeftBitmap;
    return {
        position: fullWidthLeftBitmap,
        length: fullWidthBitmap,
    };
}

Time zones
Overview
Lightweight Charts™ does not natively support time zones. If necessary, you should handle time zone adjustments manually.

The library processes all date and time values in UTC. To support time zones, adjust each bar's timestamp in your dataset based on the appropriate time zone offset. Therefore, a UTC timestamp should correspond to the local time in the target time zone.

Consider the example. A data point has the 2021-01-01T10:00:00.000Z timestamp in UTC. You want to display it in the Europe/Moscow time zone, which has the UTC+03:00 offset according to the IANA time zone database. To do this, adjust the original UTC timestamp by adding 3 hours. Therefore, the new timestamp should be 2021-01-01T13:00:00.000Z.

info
When converting time zones, consider the following:

Adding a time zone offset could change not only the time but the date as well.
An offset may vary due to DST (Daylight Saving Time) or other regional adjustments.
If your data is measured in business days and does not include a time component, in most cases, you should not adjust it to a time zone.
Approaches
Consider the approaches below to convert time values to the required time zone.

Using pure JavaScript
For more information on this approach, refer to StackOverflow.

function timeToTz(originalTime, timeZone) {
    const zonedDate = new Date(new Date(originalTime * 1000).toLocaleString('en-US', { timeZone }));
    return zonedDate.getTime() / 1000;
}

If you only need to support a client (local) time zone, you can use the following function:

function timeToLocal(originalTime) {
    const d = new Date(originalTime * 1000);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()) / 1000;
}


Using the date-fns-tz library
You can use the utcToZonedTime function from the date-fns-tz library as follows:

import { utcToZonedTime } from 'date-fns-tz';

function timeToTz(originalTime, timeZone) {
    const zonedDate = utcToZonedTime(new Date(originalTime * 1000), timeZone);
    return zonedDate.getTime() / 1000;
}

Using the IANA time zone database
If you process a large dataset and approaches above do not meet your performance requirements, consider using the tzdata.

This approach can significantly improve performance for the following reasons:

You do not need to calculate the time zone offset for every data point individually. Instead, you can look up the correct offset just once for the first timestamp using a fast binary search.
After finding the starting offset, you go through the rest data and check whether an offset should be changed, for example, because of DST starting/ending.
Why are time zones not supported?
The approaches above were not implemented in Lightweight Charts™ for the following reasons:

Using pure JavaScript is slow. In our tests, processing 100,000 data points took over 20 seconds.
Using the date-fns-tz library introduces additional dependencies and is also slow. In our tests, processing 100,000 data points took 18 seconds.
Incorporating the IANA time zone database increases the bundle size by 29.9 kB, which is nearly the size of the entire Lightweight Charts™ library.
Since time zone support is not required for all users, it is intentionally left out of the library to maintain high performance and a lightweight package size.

